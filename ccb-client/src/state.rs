use crate::protocol::{AcpEvent, PermissionOption, RequestId};

/// One rendered line of the conversation.
#[derive(Clone, Debug)]
pub struct Message {
    pub role: Role,
    pub text: String,
    /// A system message that is a compaction boundary rather than a notice.
    /// `CompactBoundaryMessage.tsx` draws these differently from other system
    /// output, so the flag lives on the message instead of being guessed from
    /// the text.
    pub compaction: bool,
    /// Set for tool messages: the call itself, so the UI layer decides how to
    /// style it and the transcript and live view cannot disagree.
    pub tool: Option<ToolCall>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    User,
    Assistant,
    /// The assistant's private reasoning, rendered dim.
    Thought,
    /// A tool call and its output.
    Tool,
    /// The agent's plan, rendered as a checklist.
    Plan,
    /// A terminal's command line and output.
    Terminal,
    /// System notices: errors, limits, shutdown, compaction.
    System,
}

impl Message {
    pub fn new(role: Role, text: impl Into<String>) -> Self {
        Self { role, text: text.into(), tool: None, compaction: false }
    }

    /// A compaction boundary notice.
    pub fn compaction(summary: impl Into<String>) -> Self {
        Self {
            role: Role::System,
            text: summary.into(),
            tool: None,
            compaction: true,
        }
    }

    /// A tool message keeps the call so the renderer can style it.
    pub fn tool(call: ToolCall) -> Self {
        let text = call.body_text();
        Self { role: Role::Tool, text, tool: Some(call), compaction: false }
    }
}

/// A tool call in flight or finished, accumulated by `toolCallId`.
#[derive(Clone, Debug, Default)]
pub struct ToolCall {
    /// The protocol's key for this call, used to match later updates.
    pub id: String,
    pub name: String,
    pub title: Option<String>,
    pub status: Option<String>,
    /// Coarse category from the protocol ("read"/"edit"/"execute"/...).
    pub kind: Option<String>,
    /// Files the call touched.
    pub locations: Vec<String>,
    pub output: String,
    /// Patch text from a `type:"diff"` block, rendered with line colouring.
    pub diff: Option<String>,
    /// Process exit status, when the tool reported one (shell calls).
    pub exit_code: Option<i32>,
}
impl ToolCall {
    /// Flattened text for dumps and the status line. The UI renders the call
    /// itself (see `toolrender::render`) so diff lines keep their colour.
    pub fn body_text(&self) -> String {
        let label = self.title.clone().unwrap_or_else(|| self.name.clone());
        let mut out = match &self.status {
            Some(s) if !s.is_empty() => format!("{label}  {s}"),
            _ => label,
        };
        for path in &self.locations {
            out.push_str(&format!("\n{path}"));
        }
        if let Some(patch) = &self.diff {
            if !patch.is_empty() {
                out.push('\n');
                out.push_str(patch);
                return out;
            }
        }
        if !self.output.is_empty() {
            out.push('\n');
            out.push_str(&self.output);
        }
        out
    }
}

/// One rendered line with a colour role, so the UI can style diff lines and
/// tool output without re-parsing text.
#[derive(Clone, Debug)]
pub struct StyledLine {
    pub text: String,
    pub tone: Tone,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tone {
    Normal,
    Dim,
    Added,
    Removed,
    Path,
}

/// Pending permission prompt the user must answer before the turn continues.
#[derive(Clone, Debug)]
pub struct PendingPermission {
    pub id: RequestId,
    pub title: String,
    pub description: Option<String>,
    pub tool_name: Option<String>,
    pub options: Vec<PermissionOption>,
    /// Highlighted option index for arrow/number key selection.
    pub selected: usize,
}

/// One thing the agent produced, kept in arrival order.
///
/// The REPL renders a single stream: whatever arrives next appears below
/// whatever arrived before it. Holding thinking, tool calls and text in
/// separate fields loses that order, so they live in one list instead.
#[derive(Clone, Debug)]
pub enum TurnItem {
    /// A committed message (the user's prompt, a system notice).
    Message(Message),
    /// The assistant's visible text, growing as chunks arrive.
    Assistant(String),
    /// The assistant's reasoning, growing as chunks arrive.
    Thinking(String),
    /// A tool call, updated in place by its `toolCallId`.
    Tool(ToolCall),
}

/// Everything the TUI renders and the input buffer state.
#[derive(Default)]
pub struct UiState {
    /// The agent's output in arrival order; the transcript is exactly this.
    pub turn: Vec<TurnItem>,
    pub messages: Vec<Message>,
    pub input: String,
    /// Up/down arrow history; `history_pos` is an index from the end.
    pub history: Vec<String>,
    pub history_pos: usize,
    pub session_id: Option<String>,
    pub busy: bool,
    /// The agent's current run state ("running"/"idle"/"requires_action").
    pub agent_state: String,
    /// Rendered plan bodies keyed by plan id, shown above the transcript tail.
    pub plans: std::collections::HashMap<String, String>,
    pub permission: Option<PendingPermission>,
    /// The session's human-readable title, shown in the transcript border.
    pub title: String,
    /// Slash commands the agent advertises, for the hint line.
    pub commands: Vec<String>,
    /// Decoded terminal output, keyed by terminal id, in arrival order.
    pub terminals: Vec<(String, String)>,
    /// Compaction lifecycle text ("compacting…", the summary, failures).
    pub compaction: Option<String>,
    /// Streaming echo of the user's own message (agents may resend it).
    pub user_echo: Option<String>,
    /// Prompts the user sent while a turn was still running, shown under the
    /// input as `PromptInputQueuedCommands` does.
    pub queued: Vec<String>,
    pub usage: Option<(u64, u64, Option<f64>)>,
    pub status: String,
    pub quit: bool,
    /// Did the input scroll past the end? Pin the view to the bottom then.
    pub follow_bottom: bool,
}

/// Which streaming item a chunk belongs to.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Slot {
    Assistant,
    Thinking,
}

/// A mutable reference to the streaming item of the given kind, but only when
/// it is the most recent thing the agent produced. A chunk after a tool call
/// starts a new block: the agent thought, then acted, then thought again, and
/// the transcript should show three things in that order, not two merged.
fn last_slot(turn: &mut [TurnItem], want: Slot) -> Option<&mut String> {
    match turn.last_mut()? {
        TurnItem::Assistant(s) if want == Slot::Assistant => Some(s),
        TurnItem::Thinking(s) if want == Slot::Thinking => Some(s),
        _ => None,
    }
}

impl UiState {

    /// Apply one protocol event to the view state.
    pub fn apply(&mut self, event: AcpEvent) {
        match event {
            AcpEvent::SessionReady { session_id } => {
                self.session_id = Some(session_id);
            }
            AcpEvent::AgentMessageChunk { text, .. } => {
                // Extend the most recent assistant item, or start one, so
                // chunks and the tools between them keep their arrival order.
                match last_slot(&mut self.turn, Slot::Assistant) {
                    Some(slot) => slot.push_str(&text),
                    None => self.turn.push(TurnItem::Assistant(text)),
                }
                self.follow_bottom = true;
            }
            AcpEvent::AgentMessage { text, .. } => {
                // The final message replaces the chunks in the same slot.
                match last_slot(&mut self.turn, Slot::Assistant) {
                    Some(slot) => *slot = text,
                    None => self.turn.push(TurnItem::Assistant(text)),
                }
                self.finish_turn();
            }
            AcpEvent::AgentThoughtChunk { text, .. } => {
                match last_slot(&mut self.turn, Slot::Thinking) {
                    Some(slot) => slot.push_str(&text),
                    None => self.turn.push(TurnItem::Thinking(text)),
                }
                self.follow_bottom = true;
            }
            AcpEvent::AgentThought { text, .. } => {
                match last_slot(&mut self.turn, Slot::Thinking) {
                    Some(slot) => *slot = text,
                    None => self.turn.push(TurnItem::Thinking(text)),
                }
            }
            AcpEvent::ToolCallUpdate {
                tool_call_id,
                name,
                title,
                status,
                kind,
                locations,
                content_text,
                diff,
            } => {
                // ACP keys updates by toolCallId. Interleaved tools would
                // otherwise dump their output into whichever call came last.
                let tool = match self.turn.iter_mut().find_map(|item| match item {
                    TurnItem::Tool(t) if t.id == tool_call_id => Some(t),
                    _ => None,
                }) {
                    Some(t) => t,
                    None => {
                        self.turn.push(TurnItem::Tool(ToolCall {
                            id: tool_call_id,
                            ..Default::default()
                        }));
                        match self.turn.last_mut() {
                            Some(TurnItem::Tool(t)) => t,
                            _ => unreachable!("just pushed a tool"),
                        }
                    }
                };
                if let Some(n) = name {
                    tool.name = n;
                }
                if let Some(t) = title {
                    tool.title = Some(t);
                }
                if let Some(s) = status {
                    tool.status = Some(s);
                }
                if let Some(k) = kind {
                    tool.kind = Some(k);
                }
                if !locations.is_empty() {
                    tool.locations = locations;
                }
                if let Some(c) = content_text {
                    tool.output = c;
                }
                if let Some(d) = diff {
                    tool.diff = Some(d.patch);
                    if !d.paths.is_empty() {
                        tool.locations = d.paths;
                    }
                }
                self.follow_bottom = true;
            }
            AcpEvent::ToolCallContentChunk { text, .. } => {
                if let Some(tool) = self.last_tool_mut() {
                    tool.output.push_str(&text);
                }
                self.follow_bottom = true;
            }
            AcpEvent::UsageUpdate { used, size, cost_usd } => {
                self.usage = Some((used, size, cost_usd));
            }

            AcpEvent::StateUpdate { state } => {
                self.agent_state = state.clone();
                // requires_action ends a turn from the client's point of view:
                // the agent is waiting on the user, not still streaming.
                self.busy = state == "running";
                if state == "requires_action" {
                    self.finish_turn();
                }
            }
            AcpEvent::PlanUpdate { plan_id, text } => {
                self.plans.insert(plan_id, text);
            }
            AcpEvent::PlanRemoved { plan_id } => {
                self.plans.remove(&plan_id);
            }
            AcpEvent::SessionTitle { title } => {
                self.title = title;
            }
            AcpEvent::AvailableCommands { names } => {
                self.commands = names;
            }
            AcpEvent::ConfigOptions { summary } => {
                self.status = summary;
            }
            AcpEvent::TerminalUpdate { terminal_id, command, exited } => {
                // A command with no exit status starts (or restarts) the
                // entry; one carrying an exit status annotates the entry that
                // already collected the output.
                if let Some((_, existing)) =
                    self.terminals.iter_mut().find(|(id, _)| id == &terminal_id)
                {
                    if let Some(code) = exited {
                        existing.push_str(&format!("  (exit {code})"));
                    } else if existing.starts_with("$ ") {
                        existing.clear();
                        existing.push_str(&format!("$ {}", command.as_deref().unwrap_or("")));
                    }
                } else {
                    let line = format!("$ {}", command.as_deref().unwrap_or(&terminal_id));
                    self.terminals.push((terminal_id, line));
                }
            }
            AcpEvent::TerminalOutputChunk { terminal_id, text } => {
                if let Some((_, existing)) =
                    self.terminals.iter_mut().find(|(id, _)| id == &terminal_id)
                {
                    if !text.is_empty() && !existing.ends_with('\n') {
                        existing.push('\n');
                    }
                    existing.push_str(&text);
                } else {
                    self.terminals.push((terminal_id, text));
                }
                self.follow_bottom = true;
            }
            AcpEvent::CompactionUpdate { status, summary } => {
                self.compaction = match status.as_str() {
                    // The in-progress notice is transient; the completed
                    // summary is what stays in the transcript.
                    "in_progress" => None,
                    "failed" => Some("compaction failed".to_string()),
                    "cancelled" => None,
                    _ => summary,
                };
            }
            AcpEvent::CompactionSummaryChunk { text } => {
                self.compaction.get_or_insert_default().push_str(&text);
                self.follow_bottom = true;
            }
            // We record the prompt at submit time; the agent echoes it back, so
            // user messages are only rendered if they differ from ours.
            AcpEvent::UserMessageChunk { text } => {
                self.set_user_echo(&text);
            }
            AcpEvent::UserMessage { text } => {
                self.set_user_echo(&text);
            }
            AcpEvent::RequestPermission(req) => {
                let options = req.options;
                // Default to the first allow option if there is one.
                let selected = options
                    .iter()
                    .position(|o| o.kind.starts_with("allow"))
                    .unwrap_or(0);
                self.permission = Some(PendingPermission {
                    id: req.id,
                    title: req.title,
                    description: req.description,
                    tool_name: req.tool_name,
                    options,
                    selected,
                });
            }
            AcpEvent::Ignored => {}
            AcpEvent::Error { message } => {
                self.status = message.clone();
                // Also keep it in the transcript: an error the user scrolled
                // past should stay readable, which is what SystemTextMessage
                // does on the TypeScript side.
                self.messages.push(Message::new(Role::System, message));
            }
            AcpEvent::Closed => {
                self.status = "connection closed".to_string();
                self.busy = false;
            }
        }
    }

    /// A turn finished. Every item is already in `turn` in arrival order and
    /// already rendered, so there is nothing to commit or reorder.
    pub fn finish_turn(&mut self) {
        self.busy = false;
    }

    /// The most recent tool call, for appending streamed output to.
    fn last_tool_mut(&mut self) -> Option<&mut ToolCall> {
        self.turn.iter_mut().rev().find_map(|item| match item {
            TurnItem::Tool(t) => Some(t),
            _ => None,
        })
    }


    /// Track the user message the agent echoed back. It is only rendered when
    /// it differs from the prompt we already committed at submit time.
    pub fn set_user_echo(&mut self, text: &str) {
        match &mut self.user_echo {
            Some(buf) if text.starts_with(buf.as_str()) => *buf = text.to_string(),
            _ => self.user_echo = Some(text.to_string()),
        }
    }


    /// Record a submitted user prompt and open the streaming slot.
    pub fn submit(&mut self, prompt: String) {
        self.turn.push(TurnItem::Message(Message::new(Role::User, prompt.clone())));
        self.messages.push(Message::new(Role::User, prompt.clone()));
        self.history.push(prompt);
        self.history_pos = 0;

        self.permission = None;
        self.busy = true;
        self.follow_bottom = true;
    }

    /// Move up (older) in the history buffer.
    pub fn history_up(&mut self) {
        if self.history.is_empty() {
            return;
        }
        if self.history_pos < self.history.len() {
            self.history_pos += 1;
            let idx = self.history.len() - self.history_pos;
            self.input = self.history[idx].clone();
        }
    }

    /// Move down (newer) in the history buffer.
    pub fn history_down(&mut self) {
        if self.history_pos == 0 {
            return;
        }
        self.history_pos -= 1;
        self.input = if self.history_pos == 0 {
            String::new()
        } else {
            let idx = self.history.len() - self.history_pos;
            self.history[idx].clone()
        };
    }


}

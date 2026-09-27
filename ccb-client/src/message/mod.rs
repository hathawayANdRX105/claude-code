//! Message rendering, ported 1:1 from `src/components/messages/`.
//!
//! The TypeScript side dispatches on message type and renders each with its
//! own component (40 of them, 3974 lines). Here each ported component is a
//! function from its own view data to lines, and [`render_message`] is the
//! dispatcher that replaces `Messages.tsx`'s type switch.

use ratatui::text::Line;

use crate::render;
use crate::state::{Message, Role, UiState};
use crate::theme::{fig, Ink};

// The per-type renderers are the port of `src/components/messages/`. They are
// public modules so the transcript can render a specific message type
// directly, not only through [`render_message`].
pub mod assistant;
pub mod system;
pub mod tool;
pub mod user;

/// Render any message. This replaces the type switch in `Messages.tsx`.
pub fn render_message(m: &Message) -> Vec<Line<'static>> {
    let mut lines = match m.role {
        Role::User => user::dispatch(m),
        Role::Assistant => assistant::dispatch(m),
        Role::Thought => assistant::render_assistant_thinking(m.text.as_str()),
        Role::Plan => assistant::render_plan_body(m.text.as_str()),
        Role::Terminal => render_terminal(m.text.as_str()),
        Role::Tool => match &m.tool {
            // The frame (status diamond, `⎿` gutter) is the message layer's;
            // the body under it is chosen by kind in `toolrender`.
            Some(call) => tool::render_tool_call(call),
            None => Vec::new(),
        },
    };
    lines.push(render::blank());
    lines
}

/// A terminal command and its output, with the `terminal` label.
fn render_terminal(text: &str) -> Vec<Line<'static>> {
    let mut lines = vec![render::header(
        fig::DIAMOND_FILLED,
        Ink::Success,
        "terminal",
        Ink::BashBorder,
    )];
    let mut body = render::wrap(text, ratatui::style::Style::default().fg(Ink::Subtle.color()));
    render::indent(&mut body, 1);
    lines.extend(body);
    lines
}

/// The `⎿` gutter `MessageResponse.tsx` puts before a nested response body.
pub fn response_body(body: Vec<Line<'static>>) -> Vec<Line<'static>> {
    let mut out: Vec<Line<'static>> = vec![render::line(vec![render::dim(
        fig::RESPONSE_GUTTER.to_string(),
    )])];
    let mut body = body;
    render::indent(&mut body, 1);
    out.extend(body);
    out
}

/// Every message the transcript shows, in render order, with the live
/// streaming tail last. This is the single path both the screen and the
/// verification dump use, so they cannot disagree.
pub fn render_transcript(state: &UiState) -> Vec<Vec<Line<'static>>> {
    let mut out: Vec<Vec<Line<'static>>> = Vec::new();
    for m in ordered_messages(state) {
        out.push(render_message(&m));
    }
    out
}

/// The messages in the order the REPL shows them: committed history, then the
/// live streaming assistant text, thinking, and in-flight tool calls.
fn ordered_messages(state: &UiState) -> Vec<Message> {
    let mut out: Vec<Message> = state.messages.clone();
    if let Some(s) = &state.streaming {
        if !s.is_empty() {
            out.push(Message::new(Role::Assistant, s.clone()));
        }
    }
    if let Some(t) = &state.thinking {
        if !t.is_empty() {
            out.push(Message::new(Role::Thought, t.clone()));
        }
    }
    for tool in &state.tools {
        out.push(Message::tool(tool.clone()));
    }
    if let Some(text) = &state.user_echo {
        let is_echo = out
            .iter()
            .rev()
            .find(|m| m.role == Role::User)
            .is_some_and(|m| &m.text == text);
        if !text.is_empty() && !is_echo {
            out.push(Message::new(Role::User, text.clone()));
        }
    }
    for (_, text) in &state.terminals {
        if !text.is_empty() {
            out.push(Message::new(Role::Terminal, text.clone()));
        }
    }
    if let Some(text) = &state.compaction {
        out.push(Message::new(Role::Thought, text.clone()));
    }
    // Plans render after the tool calls, sorted by id for a stable order.
    let mut plan_ids: Vec<&String> = state.plans.keys().collect();
    plan_ids.sort();
    for id in plan_ids {
        out.push(Message::new(Role::Plan, state.plans[id].clone()));
    }
    out
}

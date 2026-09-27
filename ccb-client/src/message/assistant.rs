//! Assistant-side message renderers.
//!
//! Ported from `src/components/messages/AssistantTextMessage.tsx`,
//! `AssistantThinkingMessage.tsx`, `HighlightedThinkingText.tsx`,
//! `CompactBoundaryMessage.tsx`, `PlanApprovalMessage.tsx`,
//! `TaskAssignmentMessage.tsx` and `GroupedToolUseContent.tsx`.

use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};

use crate::render;
use crate::state::Message;
use crate::theme::{fig, Ink};

/// The label `AssistantThinkingMessage` renders above the reasoning.
const THINKING_LABEL: &str = "∴ Thinking";

/// Dispatch an assistant message. Tool calls keep their `ToolCall` and go to
/// the tool renderer; everything else renders as text.
pub fn dispatch(m: &Message) -> Vec<Line<'static>> {
    match &m.tool {
        Some(call) => crate::message::tool::render_tool_call(call),
        None => render_assistant_text(m.text.as_str()),
    }
}

/// Ported from `AssistantTextMessage.tsx`. The TSX runs the text through
/// `<Markdown>`; this client has no markdown renderer, so the text is emitted
/// as-is and only the error strings the TSX colours specially get their look.
pub fn render_assistant_text(text: &str) -> Vec<Line<'static>> {
    if text.is_empty() {
        return Vec::new();
    }
    let style = if is_error_text(text) {
        Style::default().fg(Ink::Error.color())
    } else {
        Style::default().fg(Ink::Text.color())
    };
    render::wrap(text, style)
}

/// Ported from `AssistantThinkingMessage.tsx`: a dim italic `∴ Thinking` label,
/// then the reasoning indented one level. This client always shows the full
/// block, so the TSX's collapsed single-line form is not reachable.
pub fn render_assistant_thinking(text: &str) -> Vec<Line<'static>> {
    if text.is_empty() {
        return Vec::new();
    }
    let italic = Style::default()
        .fg(Ink::Dim.color())
        .add_modifier(Modifier::ITALIC);
    let mut out = vec![render::line(vec![Span::styled(
        format!("{THINKING_LABEL}…"),
        italic,
    )])];
    for l in text.lines() {
        out.push(thinking_line(l));
    }
    out
}

/// The words `HighlightedThinkingText` emphasises inside reasoning. Each is
/// rendered in the theme's foreground so it stands out from the dim body.
const THINKING_KEYWORDS: &[&str] = &["Wait", "Actually", "Therefore", "However", "Alternatively"];

/// One reasoning line with its keywords emphasised.
fn thinking_line(text: &str) -> Line<'static> {
    let dim = Style::default().fg(Ink::Dim.color());
    let lit = Style::default().fg(Ink::Text.color());
    let mut spans: Vec<Span<'static>> = Vec::new();
    let mut rest = text;
    while !rest.is_empty() {
        let mut best: Option<(usize, &str)> = None;
        for kw in THINKING_KEYWORDS {
            if let Some(at) = rest.find(kw) {
                if best.is_none_or(|(b, _)| at < b) {
                    best = Some((at, kw));
                }
            }
        }
        let Some((at, kw)) = best else {
            spans.push(Span::styled(rest.to_string(), dim));
            break;
        };
        if at > 0 {
            spans.push(Span::styled(rest[..at].to_string(), dim));
        }
        spans.push(Span::styled(kw.to_string(), lit));
        rest = &rest[at + kw.len()..];
    }
    render::line(spans)
}

/// Ported from `CompactBoundaryMessage.tsx`: the separator shown where a
/// conversation was compacted.
pub fn render_compact_boundary() -> Vec<Line<'static>> {
    vec![render::line(vec![
        render::dim(fig::HEAVY_HORIZONTAL.repeat(3)),
        render::raw(" "),
        render::dim("conversation compacted"),
        render::raw(" "),
        render::dim(fig::HEAVY_HORIZONTAL.repeat(3)),
    ])]
}

/// Ported from `PlanApprovalMessage.tsx`: the plan the agent wants approved.
pub fn render_plan_approval(text: &str) -> Vec<Line<'static>> {
    let mut out = vec![render::header(
        fig::DIAMOND_FILLED,
        Ink::PlanMode,
        "plan",
        Ink::PlanMode,
    )];
    let mut body = render::wrap(text, Style::default().fg(Ink::Text.color()));
    render::indent(&mut body, 1);
    out.extend(body);
    out.push(render::line(vec![render::dim("ctrl+o to expand")]));
    out
}

/// The checklist a plan renders as, from the protocol's `plan_update` items.
/// The parser already marks each entry's status in its leading bracket.
pub fn render_plan_body(text: &str) -> Vec<Line<'static>> {
    if text.is_empty() {
        return Vec::new();
    }
    let mut out = vec![render::header(
        fig::DIAMOND_FILLED,
        Ink::PlanMode,
        "plan",
        Ink::PlanMode,
    )];
    for entry in text.lines() {
        let tone = if entry.starts_with("[x]") {
            Ink::Success
        } else if entry.starts_with("[>]") {
            Ink::ChromeYellow
        } else {
            Ink::Subtle
        };
        out.push(render::line(vec![
            render::raw(render::INDENT),
            Span::styled(entry.to_string(), Style::default().fg(tone.color())),
        ]));
    }
    out
}

/// Ported from `TaskAssignmentMessage.tsx`: a task handed to a subagent.
pub fn render_task_assignment(text: &str) -> Vec<Line<'static>> {
    let mut out = vec![render::header(
        fig::black_circle(),
        Ink::Purple,
        "task",
        Ink::Purple,
    )];
    let mut body = render::wrap(text, Style::default().fg(Ink::Subtle.color()));
    render::indent(&mut body, 1);
    out.extend(body);
    out
}

/// Ported from `GroupedToolUseContent.tsx`: several tool calls collapsed into
/// one row with a count.
pub fn render_grouped_tool_use(text: &str, count: usize) -> Vec<Line<'static>> {
    let mut out = vec![render::header(
        fig::DIAMOND_FILLED,
        Ink::Subtle,
        &format!("{count} tool calls"),
        Ink::Subtle,
    )];
    if !text.is_empty() {
        let mut body = render::wrap(text, Style::default().fg(Ink::Subtle.color()));
        render::indent(&mut body, 1);
        out.extend(body);
    }
    out
}

/// Whether the text is one of the API error strings the TSX colours as
/// errors, from the `startsWithApiErrorPrefix` family in
/// `src/services/api/errors.ts`.
fn is_error_text(text: &str) -> bool {
    const PREFIXES: &[&str] = &[
        "API Error",
        "Credit balance is too low",
        "Invalid API key",
        "Prompt is too long",
        "Organization has been disabled",
    ];
    PREFIXES.iter().any(|p| text.starts_with(p))
}

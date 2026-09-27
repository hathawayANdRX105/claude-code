//! Tool-call message rendering.
//!
//! Ported from `src/components/messages/AssistantToolUseMessage.tsx` (the
//! per-call frame) and `CollapsedReadSearchContent.tsx` (the collapsed
//! read/search preview). The per-kind bodies live in `crate::toolrender`,
//! ported from each tool's own `UI.tsx`.

use ratatui::style::Style;
use ratatui::text::Line;

use crate::render;
use crate::state::ToolCall;
use crate::theme::{fig, Ink, status_glyph};

/// Ported from `AssistantToolUseMessage.tsx`: the frame around a tool call —
/// the status diamond, the tool's label, and its body.
///
/// The body itself is chosen by `kind` and rendered in `crate::toolrender`;
/// this function supplies the header and the `⎿` gutter the TSX gets from
/// `MessageResponse`.
pub fn render_tool_call(call: &ToolCall) -> Vec<Line<'static>> {
    let (glyph, glyph_ink) = status_glyph(call.status.as_deref());
    let label = call
        .title
        .clone()
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| call.name.clone());

    let mut header = vec![
        render::bold(glyph.to_string(), glyph_ink),
        render::raw(" "),
        render::bold(label, Ink::Text),
    ];
    // The TSX shows the running/failed word next to the diamond, because the
    // diamond alone does not say whether the call is still going.
    if let Some(status) = &call.status {
        if status == "in_progress" || status == "failed" {
            header.push(render::raw(" "));
            header.push(match status.as_str() {
                "failed" => render::colored(status.clone(), Ink::Error),
                _ => render::dim(status.clone()),
            });
        }
    }
    let mut out = vec![render::line(header)];

    let body = crate::toolrender::render_body(call);
    if !body.is_empty() {
        // The body is nested under the call, so it gets the response gutter
        // `MessageResponse` renders.
        let mut inner = body;
        render::indent(&mut inner, 1);
        out.push(render::line(vec![render::dim(fig::RESPONSE_GUTTER.trim_end())]));
        out.extend(inner);
    }
    out
}

/// Ported from the top of `AssistantToolUseMessage.tsx`: the shape shown while
/// a call is still queued and has produced nothing yet.
pub fn render_tool_use(call: &ToolCall) -> Vec<Line<'static>> {
    if call.output.is_empty() && call.diff.is_none() && call.locations.is_empty() {
        return vec![render::line(vec![
            render::colored(fig::DIAMOND_OPEN, Ink::Claude),
            render::raw(" "),
            render::dim("running"),
        ])];
    }
    render_tool_call(call)
}

/// Ported from `CollapsedReadSearchContent.tsx`: the preview a read or search
/// collapses to when its output is long. The full listing lives in
/// `toolrender::read` and `toolrender::search`; this is the short form.
pub fn render_collapsed_read(text: &str) -> Vec<Line<'static>> {
    const PREVIEW_LINES: usize = 6;
    if text.is_empty() {
        return Vec::new();
    }
    let lines: Vec<&str> = text.lines().collect();
    let shown = lines.len().min(PREVIEW_LINES);
    let mut out = vec![render::line(vec![
        render::colored(fig::DIAMOND_FILLED, Ink::Subtle),
        render::raw(" "),
        render::dim(format!("{} lines", lines.len())),
    ])];
    let mut body = render::wrap(&lines[..shown].join("\n"), Style::default().fg(Ink::Subtle.color()));
    render::indent(&mut body, 1);
    out.extend(body);
    if lines.len() > shown {
        out.push(render::line(vec![
            render::raw(render::INDENT),
            render::dim(format!("… {} more lines", lines.len() - shown)),
        ]));
    }
    out
}

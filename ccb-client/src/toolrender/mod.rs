//! Per-tool-call rendering, ported from the `UI.tsx` files under
//! `packages/builtin-tools/src/tools/`.
//!
//! The TypeScript side dispatches on tool identity: each tool exports its own
//! `renderToolUseMessage`. ACP instead reports a coarse `kind` on every call
//! (`read`, `edit`, `search`, `execute`, `fetch`, `think`, `delete`, `move`,
//! `switch_mode`, `other`). Most tools within a kind share a layout, so the
//! Rust side groups by kind and special-cases only the tools whose rendering
//! genuinely differs (Edit's diff, Read's collapsed preview, Grep's grouped
//! results, Bash's terminal).

use ratatui::text::Line;

use crate::render;
use crate::state::ToolCall;
use crate::theme::{fig, Ink, status_glyph};

mod bash;
mod edit;
mod fetch;
mod read;
mod search;

pub use bash::render_bash;
pub use edit::render_edit;
pub use fetch::render_fetch;
pub use read::render_read;
pub use search::render_search;

/// Render one tool call. Returns the call's lines, without a trailing blank.
pub fn render(call: &ToolCall) -> Vec<Line<'static>> {
    let mut lines = header(call);
    let body = match call.kind.as_deref() {
        Some("edit") | Some("delete") | Some("move") => edit::render(call),
        Some("read") => read::render(call),
        Some("search") => search::render(call),
        Some("execute") => bash::render(call),
        Some("fetch") => fetch::render(call),
        // `think`, `switch_mode` and `other` have no distinct layout; the
        // generic output block below is what the REPL shows for them too.
        _ => generic(call),
    };
    let had_body = !body.is_empty();
    lines.extend(body);
    if had_body {
        lines.push(render::blank());
    }
    lines
}

/// The status line every call starts with: the diamond glyph, the tool's
/// label, and its status. Mirrors the header of `AssistantToolUseMessage`.
fn header(call: &ToolCall) -> Vec<Line<'static>> {
    let (glyph, glyph_ink) = status_glyph(call.status.as_deref());
    let label = call
        .title
        .clone()
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| call.name.clone());
    let mut spans = vec![
        render::bold(glyph.to_string(), glyph_ink),
        render::raw(" "),
        render::bold(label, Ink::Text),
    ];
    if let Some(status) = &call.status {
        // The glyph already encodes pending/settled; showing the word too is
        // what the REPL does for in_progress and failed.
        if status == "in_progress" || status == "failed" {
            spans.push(render::raw(" "));
            spans.push(match status.as_str() {
                "failed" => render::colored(status.clone(), Ink::Error),
                _ => render::dim(status.clone()),
            });
        }
    }
    vec![render::line(spans)]
}

/// The path list a file tool shows under its header.
fn paths(call: &ToolCall) -> Vec<Line<'static>> {
    let mut out = Vec::new();
    if call.locations.len() == 1 {
        out.push(render::line(vec![render::colored(
            shorten_path(&call.locations[0]),
            Ink::ProfessionalBlue,
        )]));
    } else {
        for p in &call.locations {
            out.push(render::line(vec![
                render::raw(render::INDENT),
                render::colored(shorten_path(p), Ink::ProfessionalBlue),
            ]));
        }
    }
    out
}

/// The fallback body: raw tool output, dimmed, one line per row.
fn generic(call: &ToolCall) -> Vec<Line<'static>> {
    let mut out = paths(call);
    if !call.output.is_empty() {
        let mut body = render::wrap(&call.output, ratatui::style::Style::default().fg(Ink::Subtle.color()));
        render::indent(&mut body, 1);
        out.extend(body);
    }
    out
}

/// Keep the last three path segments, which is enough to identify a file
/// without filling the line.
pub fn shorten_path(path: &str) -> String {
    const KEEP: usize = 3;
    let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() <= KEEP {
        return path.to_string();
    }
    format!("…/{}", parts[parts.len() - KEEP..].join("/"))
}

/// The spinner frame list from `src/constants/figures.ts`, used while a call
/// is still running.
pub fn spinner_frames() -> &'static [&'static str] {
    &["✻", "✽", "✻", "✽", "✻"]
}

/// `fig` re-export so tool modules reach the glyphs through one path.
pub use fig as figures;

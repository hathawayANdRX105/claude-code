//! Edit-family calls: `FileEditTool`, `FileWriteTool`, `NotebookEditTool`, and
//! the delete/move kinds.
//!
//! Ported from `packages/builtin-tools/src/tools/FileEditTool/UI.tsx` and
//! `src/components/FileEditToolUpdatedMessage.tsx`: the summary line
//! ("Added N lines, removed M lines") followed by the gutter-formatted diff,
//! both inside a `⎿` response body.

use ratatui::text::Line;

use crate::render;
use crate::state::ToolCall;
use crate::theme::Ink;
use crate::toolrender::diff;
use crate::toolrender::shorten_path;

/// The `FilePathLink` the TSX renders above the diff: the display path in the
/// theme's file colour.
fn path_line(call: &ToolCall) -> Vec<Line<'static>> {
    call.locations
        .first()
        .map(|p| {
            vec![render::line(vec![render::colored(
                shorten_path(p),
                Ink::ProfessionalBlue,
            )])]
        })
        .unwrap_or_default()
}

/// Render an edit-family call.
pub fn render(call: &ToolCall) -> Vec<Line<'static>> {
    let patch = match &call.diff {
        Some(p) if !p.is_empty() => p.clone(),
        // Without a diff block there is nothing structured to show; the raw
        // output is the best available.
        _ => return fallback(call),
    };
    let mut out = path_line(call);
    out.push(diff::change_summary(&patch));
    out.extend(diff::render_diff(&patch));
    out
}

fn fallback(call: &ToolCall) -> Vec<Line<'static>> {
    let mut out = path_line(call);
    if !call.output.is_empty() {
        let mut body = render::wrap(
            &call.output,
            ratatui::style::Style::default().fg(Ink::Subtle.color()),
        );
        render::indent(&mut body, 1);
        out.extend(body);
    }
    out
}

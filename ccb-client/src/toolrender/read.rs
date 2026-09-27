//! Read-family calls: `FileReadTool`, `ReadMcpResourceTool`.
//!
//! Ported from `packages/builtin-tools/src/tools/FileReadTool/UI.tsx` and
//! `src/components/CollapsedReadSearchContent.tsx`. The TSX shows a preview
//! capped to a few lines with a trailing indicator of how much was elided.

use ratatui::style::Style;
use ratatui::text::Line;

use crate::render;
use crate::state::ToolCall;
use crate::theme::Ink;
use crate::toolrender::shorten_path;

/// How many lines of a read the preview shows before eliding, matching the
/// collapsed preview's cap.
const PREVIEW_LINES: usize = 10;

/// Render a read call: the path, then a capped preview of the contents.
pub fn render(call: &ToolCall) -> Vec<Line<'static>> {
    let mut out: Vec<Line<'static>> = Vec::new();
    if let Some(path) = call.locations.first() {
        out.push(render::line(vec![render::colored(
            shorten_path(path),
            Ink::ProfessionalBlue,
        )]));
    }
    if call.output.is_empty() {
        return out;
    }
    let lines: Vec<&str> = call.output.lines().collect();
    let shown = lines.len().min(PREVIEW_LINES);
    let mut body = render::wrap(
        &lines[..shown].join("\n"),
        Style::default().fg(Ink::Subtle.color()),
    );
    if lines.len() > shown {
        body.push(render::dim_line(format!(
            "… {} more lines",
            lines.len() - shown
        )));
    }
    render::indent(&mut body, 1);
    out.extend(body);
    out
}

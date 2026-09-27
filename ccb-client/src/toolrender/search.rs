//! Search-family calls: `GrepTool`, `GlobTool`.
//!
//! Ported from `packages/builtin-tools/src/tools/GrepTool/UI.tsx` and
//! `GlobTool/UI.tsx`. Both list matches with the path and the matching line;
//! Grep adds the line's text.

use ratatui::text::Line;

use crate::render;
use crate::state::ToolCall;
use crate::theme::Ink;
use crate::toolrender::shorten_path;

/// How many matches the preview lists before eliding.
const MAX_MATCHES: usize = 20;

/// Render a search call.
pub fn render(call: &ToolCall) -> Vec<Line<'static>> {
    let mut out: Vec<Line<'static>> = Vec::new();
    let raw: Vec<&str> = call.output.lines().filter(|l| !l.is_empty()).collect();
    if raw.is_empty() {
        if let Some(p) = call.locations.first() {
            out.push(render::line(vec![render::colored(
                shorten_path(p),
                Ink::ProfessionalBlue,
            )]));
        }
        return out;
    }
    let shown = raw.len().min(MAX_MATCHES);
    for entry in &raw[..shown] {
        out.push(match entry.split_once(':') {
            // "path:line:text" from Grep, or "path:line" from Glob.
            Some((path, rest)) => {
                let mut spans = vec![render::colored(shorten_path(path), Ink::ProfessionalBlue)];
                if let Some((line_no, text)) = rest.split_once(':') {
                    spans.push(render::raw(":"));
                    spans.push(render::colored(line_no.to_string(), Ink::Subtle));
                    if !text.is_empty() {
                        spans.push(render::raw(":"));
                        spans.push(span_text(text));
                    }
                }
                render::line(spans)
            }
            None => render::line(vec![span_text(entry)]),
        });
    }
    if raw.len() > shown {
        out.push(render::dim_line(format!("… {} more matches", raw.len() - shown)));
    }
    out
}

/// Output text in the theme's foreground.
fn span_text(s: &str) -> ratatui::text::Span<'static> {
    render::text(s.to_string())
}

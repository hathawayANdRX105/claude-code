//! The diff renderer, ported from
//! `packages/color-diff-napi/native/src/lib.rs` (`ColorDiff::render`) and the
//! `StructuredDiffList` / `FileEditToolUpdatedMessage` pair on the TypeScript
//! side.
//!
//! The gutter layout is the one that module already uses, so the client shows
//! the same diff the REPL does:
//!
//! ```text
//! marker(1) + " " + right-aligned line number(max_digits) + " " + code
//! ```
//!
//! `+` lines take the add background, `-` lines the delete background, context
//! lines the terminal background. The `@@` hunk header is elided exactly as
//! `StructuredDiffList` does: it renders hunks, not the `@@` line.

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

use crate::render;
use crate::theme::Ink;

/// A diff line's role.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Marker {
    Add,
    Del,
    Ctx,
}

/// The dark-theme diff colours, from `build_theme` in the color-diff module.
fn add_line() -> Color {
    Color::Rgb(2, 40, 0)
}
fn add_word() -> Color {
    Color::Rgb(4, 71, 0)
}
fn add_decoration() -> Color {
    Color::Rgb(80, 200, 80)
}
fn delete_line() -> Color {
    Color::Rgb(61, 1, 0)
}
fn delete_word() -> Color {
    Color::Rgb(92, 2, 0)
}
fn delete_decoration() -> Color {
    Color::Rgb(220, 90, 90)
}
fn foreground() -> Color {
    Color::Rgb(248, 248, 242)
}

fn decoration_color(m: Marker) -> Color {
    match m {
        Marker::Add => add_decoration(),
        Marker::Del => delete_decoration(),
        Marker::Ctx => foreground(),
    }
}

fn line_background(m: Marker) -> Color {
    match m {
        Marker::Add => add_line(),
        Marker::Del => delete_line(),
        Marker::Ctx => Color::Reset,
    }
}

fn word_background(m: Marker) -> Color {
    match m {
        Marker::Add => add_word(),
        Marker::Del => delete_word(),
        Marker::Ctx => Color::Reset,
    }
}

/// One parsed diff line: its marker, its line number, and the code without the
/// leading marker character.
struct Entry {
    line_number: i64,
    marker: Marker,
    code: String,
}

/// Parse a `git_patch` body into entries, assigning line numbers the way
/// `ColorDiff::render` does: additions advance the new counter, deletions the
/// old one, context lines advance both.
fn parse_hunk(patch: &str) -> Vec<Entry> {
    let mut old_start: i64 = 0;
    let mut new_start: i64 = 0;
    let mut seen_header = false;
    let mut old_line = 0i64;
    let mut new_line = 0i64;

    let mut out: Vec<Entry> = Vec::new();
    for raw in patch.lines() {
        if raw.starts_with("@@") {
            // "@@ -a,b +c,d @@" seeds both counters.
            if let Some((o, n)) = parse_hunk_header(raw) {
                old_start = o;
                new_start = n;
            }
            old_line = old_start;
            new_line = new_start;
            seen_header = true;
            continue;
        }
        if raw.starts_with("diff ") || raw.starts_with("index ") || raw.starts_with("--- ")
            || raw.starts_with("+++ ") || raw.starts_with("@@") && !seen_header
        {
            continue;
        }
        if !seen_header {
            // No hunk header: number from 1 so lines still read sensibly.
            old_start = 1;
            new_start = 1;
            old_line = 1;
            new_line = 1;
            seen_header = true;
        }
        let first = raw.chars().next().unwrap_or(' ');
        let marker = match first {
            '+' => Marker::Add,
            '-' => Marker::Del,
            _ => Marker::Ctx,
        };
        let code: String = raw.chars().skip(1).collect();
        let line_number = match marker {
            Marker::Add => {
                let n = new_line;
                new_line += 1;
                n
            }
            Marker::Del => {
                let n = old_line;
                old_line += 1;
                n
            }
            Marker::Ctx => {
                let n = new_line;
                old_line += 1;
                new_line += 1;
                n
            }
        };
        out.push(Entry { line_number, marker, code });
    }
    out
}

/// Pull the two start lines out of `@@ -old,count +new,count @@`.
fn parse_hunk_header(line: &str) -> Option<(i64, i64)> {
    let inner = line.trim_start_matches('@').trim();
    let mut old = None;
    let mut new = None;
    for part in inner.split_whitespace() {
        if let Some(rest) = part.strip_prefix('-') {
            old = rest.split(',').next().and_then(|n| n.parse().ok());
        } else if let Some(rest) = part.strip_prefix('+') {
            new = rest.split(',').next().and_then(|n| n.parse().ok());
        }
    }
    match (old, new) {
        (Some(o), Some(n)) => Some((o, n)),
        _ => None,
    }
}

/// The widest line number in the hunk, which sets the gutter width.
fn max_digits(entries: &[Entry]) -> usize {
    entries
        .iter()
        .map(|e| e.line_number.max(0).to_string().len())
        .max()
        .unwrap_or(1)
        .max(1)
}

/// Count added and removed lines, the way `FileEditToolUpdatedMessage` does to
/// build its "Added N lines, Removed M lines" summary.
pub fn count_changes(patch: &str) -> (usize, usize) {
    let mut add = 0;
    let mut del = 0;
    for l in patch.lines() {
        match l.as_bytes().first() {
            Some(b'+') => add += 1,
            Some(b'-') => del += 1,
            _ => {}
        }
    }
    (add, del)
}

/// The `Added N lines, removed M lines` line, with the counts in bold, exactly
/// as `FileEditToolUpdatedMessage` builds it.
pub fn change_summary(patch: &str) -> Line<'static> {
    let (add, del) = count_changes(patch);
    let mut spans: Vec<Span<'static>> = Vec::new();
    if add > 0 {
        spans.push(render::text("Added "));
        spans.push(render::bold(add.to_string(), Ink::Text));
        spans.push(render::text(if add > 1 { " lines" } else { " line" }));
    }
    if add > 0 && del > 0 {
        spans.push(render::text(", "));
    }
    if del > 0 {
        spans.push(render::text(if add == 0 { "Removed " } else { "removed " }));
        spans.push(render::bold(del.to_string(), Ink::Text));
        spans.push(render::text(if del > 1 { " lines" } else { " line" }));
    }
    if spans.is_empty() {
        spans.push(render::text("No changes"));
    }
    render::line(spans)
}

/// Render a diff body to lines, with the gutter the color-diff module uses.
pub fn render_diff(patch: &str) -> Vec<Line<'static>> {
    let entries = parse_hunk(patch);
    if entries.is_empty() {
        return Vec::new();
    }
    let digits = max_digits(&entries);
    entries.iter().map(|e| render_entry(e, digits)).collect()
}

fn render_entry(e: &Entry, digits: usize) -> Line<'static> {
    let deco = Style::default().fg(decoration_color(e.marker));
    let bg = line_background(e.marker);
    let number = format!("{:>digits$} ", e.line_number.max(0), digits = digits);
    let mut spans: Vec<Span<'static>> = Vec::new();

    // Context lines dim their own number, matching `add_line_number`'s
    // `should_dim` for Ctx markers.
    let number_span = if e.marker == Marker::Ctx {
        Span::styled(format!(" {number} "), deco.add_modifier(Modifier::DIM))
    } else {
        Span::styled(format!(" {number} "), deco)
    };
    spans.push(number_span);

    let marker_ch = match e.marker {
        Marker::Add => "+",
        Marker::Del => "-",
        Marker::Ctx => " ",
    };
    spans.push(Span::styled(marker_ch, deco));
    spans.push(Span::raw(" "));

    // The code itself sits on the line background; deletions also dim their
    // content, as the ANSI path does.
    let code_style = Style::default().fg(foreground()).bg(bg);
    let code_style = if e.marker == Marker::Del {
        code_style.add_modifier(Modifier::DIM)
    } else {
        code_style
    };
    spans.push(Span::styled(e.code.clone(), code_style));
    render::line(spans)
}

/// Highlight a range inside a line with the word background, used when a
/// deletion and an addition sit next to each other. The color-diff module does
/// a word-level diff for those pairs; this exposes the colour it uses so
/// callers can apply it to the spans they build.
pub fn word_highlight_style(m: Marker) -> Style {
    Style::default().fg(foreground()).bg(word_background(m))
}

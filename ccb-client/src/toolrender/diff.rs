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
/// Adjacent deletion/addition runs get a word-level highlight, as
/// `ColorDiff::render` does via `find_adjacent_pairs`.
pub fn render_diff(patch: &str) -> Vec<Line<'static>> {
    let entries = parse_hunk(patch);
    if entries.is_empty() {
        return Vec::new();
    }
    let digits = max_digits(&entries);
    let markers: Vec<Marker> = entries.iter().map(|e| e.marker).collect();
    // Word ranges for the pairs, computed once and indexed by entry.
    let mut ranges: Vec<Option<Vec<Range>>> = vec![None; entries.len()];
    for (del_idx, add_idx) in find_adjacent_pairs(&markers) {
        let (del_r, add_r) =
            word_diff_ranges(&entries[del_idx].code, &entries[add_idx].code);
        if !del_r.is_empty() {
            ranges[del_idx] = Some(del_r);
        }
        if !add_r.is_empty() {
            ranges[add_idx] = Some(add_r);
        }
    }
    entries
        .iter()
        .enumerate()
        .map(|(i, e)| render_entry(e, digits, ranges[i].as_deref()))
        .collect()
}

fn render_entry(
    e: &Entry,
    digits: usize,
    word: Option<&[Range]>,
) -> Line<'static> {
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

    // The code sits on the line background; deletions also dim their content,
    // as the ANSI path does. A word range gets the stronger word background
    // on top, which is what makes a one-token change legible.
    let base = Style::default().fg(foreground()).bg(bg);
    let base = if e.marker == Marker::Del {
        base.add_modifier(Modifier::DIM)
    } else {
        base
    };
    match word.and_then(|r| r.first()).copied() {
        Some(range) => {
            for (text, colour) in apply_word_bg(&e.code, range, word_background(e.marker)) {
                let mut st = base.bg(if colour == Color::Reset { bg } else { colour });
                if text.is_empty() {
                    continue;
                }
                if e.marker == Marker::Del {
                    st = st.add_modifier(Modifier::DIM);
                }
                spans.push(Span::styled(text, st));
            }
        }
        None => spans.push(Span::styled(e.code.clone(), base)),
    }
    render::line(spans)
}
/// Byte offsets of a changed span within a line's code.
pub type Range = (usize, usize);

/// The word-level ranges that changed between a deleted and an added line. Ported from
/// `word_diff_strings` in the color-diff module: tokenize into words carrying
/// their trailing whitespace, then keep the common prefix and suffix and
/// highlight what is left.
pub fn word_diff_ranges(old: &str, new: &str) -> (Vec<Range>, Vec<Range>) {
    let old_tokens = tokenize(old);
    let new_tokens = tokenize(new);
    let (pre, _) = common_prefix_len(&old_tokens, &new_tokens);
    let (suf, _) = common_suffix_len(&old_tokens, &new_tokens);
    // Guard against overlap when the whole line is one common run.
    let suf = suf.min(old_tokens.len().saturating_sub(pre));
    let suf = suf.min(new_tokens.len().saturating_sub(pre));

    let old_changed: usize = old_tokens[pre..old_tokens.len() - suf]
        .iter()
        .map(|t| t.len())
        .sum();
    let new_changed: usize = new_tokens[pre..new_tokens.len() - suf]
        .iter()
        .map(|t| t.len())
        .sum();
    if old_changed == 0 || new_changed == 0 {
        return (Vec::new(), Vec::new());
    }
    // A change covering most of both lines is noise, not a word diff; the
    // original skips it for the same reason.
    if (old_changed + new_changed) * 2 > old.len() + new.len() {
        return (vec![(0, old.len())], vec![(0, new.len())]);
    }

    let old_start = token_offset(&old_tokens, pre);
    let new_start = token_offset(&new_tokens, pre);
    let old_end = old_start + old_changed;
    let new_end = new_start + new_changed;
    (vec![(old_start, old_end)], vec![(new_start, new_end)])
}

/// Split into runs of words and runs of whitespace, so the tokens rebuild the
/// line exactly.
fn tokenize(text: &str) -> Vec<&str> {
    let mut out: Vec<&str> = Vec::new();
    let mut start = 0usize;
    let mut in_ws = false;
    for (i, c) in text.char_indices() {
        let ws = c.is_whitespace();
        if i > start && ws != in_ws {
            out.push(&text[start..i]);
            start = i;
        }
        in_ws = ws;
    }
    if start < text.len() {
        out.push(&text[start..]);
    }
    out
}

fn common_prefix_len(a: &[&str], b: &[&str]) -> (usize, usize) {
    let n = a.iter().zip(b.iter()).take_while(|(x, y)| x == y).count();
    (n, n)
}

fn common_suffix_len(a: &[&str], b: &[&str]) -> (usize, usize) {
    let n = a
        .iter()
        .rev()
        .zip(b.iter().rev())
        .take_while(|(x, y)| x == y)
        .count();
    (n, n)
}

fn token_offset(tokens: &[&str], idx: usize) -> usize {
    tokens[..idx].iter().map(|t| t.len()).sum()
}

/// Pair each run of deletions with the run of additions that follows it, the
/// way `find_adjacent_pairs` does, so their word ranges can be matched up.
fn find_adjacent_pairs(markers: &[Marker]) -> Vec<(usize, usize)> {
    let mut pairs = Vec::new();
    let mut i = 0usize;
    while i < markers.len() {
        if markers[i] != Marker::Del {
            i += 1;
            continue;
        }
        let del_start = i;
        while i < markers.len() && markers[i] == Marker::Del {
            i += 1;
        }
        let del_end = i;
        let add_start = i;
        while i < markers.len() && markers[i] == Marker::Add {
            i += 1;
        }
        let add_end = i;
        if del_end > del_start && add_end > add_start {
            pairs.push((del_start, add_start));
        }
    }
    pairs
}

/// Apply a word range's background to the matching slice of the code.
fn apply_word_bg(code: &str, range: Range, bg: Color) -> Vec<(String, Color)> {
    let (start, end) = range;
    let (start, end) = (start.min(code.len()), end.min(code.len()));
    if start >= end {
        return vec![(code.to_string(), Color::Reset)];
    }
    let mut out = Vec::new();
    if start > 0 {
        out.push((code[..start].to_string(), Color::Reset));
    }
    out.push((code[start..end].to_string(), bg));
    if end < code.len() {
        out.push((code[end..].to_string(), Color::Reset));
    }
    out
}

//! The dark theme palette and figure constants, ported 1:1 from the TypeScript
//! REPL so the client renders with the same colours and glyphs.
//!
//! Sources:
//! - `packages/@ant/ink/src/theme/theme-types.ts` (`darkTheme`)
//! - `src/constants/figures.ts`
//! - `.impeccable.md`: Claude orange `#D77757` is the brand colour, which is
//!   `theme.claude` (rgb 215,119,87) here.

use ratatui::style::Color;

/// A theme colour. `Default` means "inherit the terminal default".
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ink {
    AutoAccept,
    BashBorder,
    Claude,
    ClaudeShimmer,
    Permission,
    PermissionShimmer,
    PlanMode,
    Ide,
    PromptBorder,
    Text,
    InverseText,
    Inactive,
    Subtle,
    Suggestion,
    Remember,
    Success,
    Error,
    Warning,
    Merged,
    DiffAdded,
    DiffRemoved,
    DiffAddedDimmed,
    DiffRemovedDimmed,
    DiffAddedWord,
    DiffRemovedWord,
    Red,
    Blue,
    Green,
    Yellow,
    Purple,
    Orange,
    Pink,
    Cyan,
    ProfessionalBlue,
    ChromeYellow,
    /// The terminal's own default foreground.
    Default,
    /// `dimColor` in Ink: the theme's `inactive` at reduced intensity.
    Dim,
}

impl Ink {
    /// The dark-theme RGB value, from `darkTheme` in `theme-types.ts`.
    pub const fn color(self) -> Color {
        match self {
            Ink::AutoAccept => Color::Rgb(175, 135, 255),
            Ink::BashBorder => Color::Rgb(253, 93, 177),
            Ink::Claude => Color::Rgb(215, 119, 87),
            Ink::ClaudeShimmer => Color::Rgb(235, 159, 127),
            Ink::Permission => Color::Rgb(177, 185, 249),
            Ink::PermissionShimmer => Color::Rgb(207, 215, 255),
            Ink::PlanMode => Color::Rgb(72, 150, 140),
            Ink::Ide => Color::Rgb(71, 130, 200),
            Ink::PromptBorder => Color::Rgb(136, 136, 136),
            Ink::Text => Color::Rgb(255, 255, 255),
            Ink::InverseText => Color::Rgb(0, 0, 0),
            Ink::Inactive => Color::Rgb(153, 153, 153),
            Ink::Subtle => Color::Rgb(80, 80, 80),
            Ink::Suggestion => Color::Rgb(177, 185, 249),
            Ink::Remember => Color::Rgb(177, 185, 249),
            Ink::Success => Color::Rgb(78, 186, 101),
            Ink::Error => Color::Rgb(255, 107, 128),
            Ink::Warning => Color::Rgb(255, 193, 7),
            Ink::Merged => Color::Rgb(175, 135, 255),
            Ink::DiffAdded => Color::Rgb(34, 92, 43),
            Ink::DiffRemoved => Color::Rgb(122, 41, 54),
            Ink::DiffAddedDimmed => Color::Rgb(71, 88, 74),
            Ink::DiffRemovedDimmed => Color::Rgb(105, 72, 77),
            Ink::DiffAddedWord => Color::Rgb(56, 166, 96),
            Ink::DiffRemovedWord => Color::Rgb(179, 89, 107),
            Ink::Red => Color::Rgb(220, 38, 38),
            Ink::Blue => Color::Rgb(37, 99, 235),
            Ink::Green => Color::Rgb(22, 163, 74),
            Ink::Yellow => Color::Rgb(202, 138, 4),
            Ink::Purple => Color::Rgb(147, 51, 234),
            Ink::Orange => Color::Rgb(234, 88, 12),
            Ink::Pink => Color::Rgb(219, 39, 119),
            Ink::Cyan => Color::Rgb(8, 145, 178),
            Ink::ProfessionalBlue => Color::Rgb(106, 155, 204),
            Ink::ChromeYellow => Color::Rgb(251, 188, 4),
            Ink::Default => Color::Reset,
            // Ink's `dimColor` renders as the terminal's dimmed foreground.
            Ink::Dim => Color::DarkGray,
        }
    }
}

/// Glyphs, ported from `src/constants/figures.ts`.
///
/// `BLACK_CIRCLE` is platform dependent in the source (`⏺` on macOS, `●`
/// elsewhere); this client is built for the terminal it runs in, so it picks
/// the same way.
pub mod fig {
    /// macOS renders `⏺` narrower than the fallback, so the source branches.
    pub const fn black_circle() -> &'static str {
        if cfg!(target_os = "macos") {
            "⏺"
        } else {
            "●"
        }
    }

    pub const BULLET_OPERATOR: &str = "∙";
    pub const TEARDROP_ASTERISK: &str = "✻";
    pub const UP_ARROW: &str = "↑";
    pub const DOWN_ARROW: &str = "↓";
    pub const LIGHTNING_BOLT: &str = "↯";
    pub const EFFORT_LOW: &str = "○";
    pub const EFFORT_MEDIUM: &str = "◐";
    pub const EFFORT_HIGH: &str = "●";
    pub const EFFORT_XHIGH: &str = "⦿";
    pub const EFFORT_MAX: &str = "◉";
    pub const PLAY_ICON: &str = "▶";
    pub const PAUSE_ICON: &str = "⏸";
    pub const REFRESH_ARROW: &str = "↻";
    pub const CHANNEL_ARROW: &str = "←";
    pub const INJECTED_ARROW: &str = "→";
    pub const FORK_GLYPH: &str = "⑂";
    /// `DIAMOND_OPEN` — running.
    pub const DIAMOND_OPEN: &str = "◇";
    /// `DIAMOND_FILLED` — completed or failed.
    pub const DIAMOND_FILLED: &str = "◆";
    pub const REFERENCE_MARK: &str = "※";
    pub const FLAG_ICON: &str = "⚑";
    pub const BLOCKQUOTE_BAR: &str = "▎";
    pub const HEAVY_HORIZONTAL: &str = "━";
    /// The `⎿` gutter prefix every `MessageResponse` renders, with its two
    /// leading spaces and trailing space, from `MessageResponse.tsx`.
    pub const RESPONSE_GUTTER: &str = "  ⎿  ";
}

/// A tool call's status, mapped to the glyph and colour the TypeScript
/// renderer uses. `AssistantToolUseMessage` picks the diamond pair: open while
/// running, filled once settled.
pub fn status_glyph(status: Option<&str>) -> (&'static str, Ink) {
    match status {
        Some("completed") => (fig::DIAMOND_FILLED, Ink::Subtle),
        Some("failed") => (fig::DIAMOND_FILLED, Ink::Error),
        Some("cancelled") => (fig::DIAMOND_FILLED, Ink::Subtle),
        Some("in_progress") | Some("pending") | None => (fig::DIAMOND_OPEN, Ink::Claude),
        Some(_) => (fig::DIAMOND_OPEN, Ink::Claude),
    }
}

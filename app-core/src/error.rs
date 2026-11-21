use std::fmt;

#[derive(Debug)]
pub enum NightingaleError {
    Io(std::io::Error),
    Json(serde_json::Error),
    Database(Box<dyn std::error::Error + Send + Sync + 'static>),
    /// A Jellyfin HTTP / parsing failure. `stage` is a short static breadcrumb
    /// (e.g. `"list items"`, `"download cover"`) so the message is consistent
    /// across every call site instead of every adapter rolling its own
    /// `format!("Jellyfin ...: {e}")`.
    Jellyfin {
        stage: &'static str,
        source: Box<dyn std::error::Error + Send + Sync + 'static>,
    },
    /// A Navidrome (Subsonic) HTTP / parsing failure. Same breadcrumb
    /// convention as `Jellyfin`.
    Navidrome {
        stage: &'static str,
        source: Box<dyn std::error::Error + Send + Sync + 'static>,
    },
    /// A Plex account or PMS request/parsing failure. Tokens are always sent
    /// in headers, so the wrapped transport error cannot contain credentials
    /// in its request URL.
    Plex {
        stage: &'static str,
        source: Box<dyn std::error::Error + Send + Sync + 'static>,
    },
    /// A YouTube Data API request/parsing failure. Access tokens travel in
    /// the `Authorization` header only, never in request URLs.
    YouTube {
        stage: &'static str,
        source: Box<dyn std::error::Error + Send + Sync + 'static>,
    },
    Other(String),
}

impl fmt::Display for NightingaleError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "{e}"),
            Self::Json(e) => write!(f, "{e}"),
            Self::Database(source) => write!(f, "{source}"),
            Self::Jellyfin { stage, source } => write!(f, "Jellyfin {stage}: {source}"),
            Self::Navidrome { stage, source } => write!(f, "Navidrome {stage}: {source}"),
            Self::Plex { stage, source } => write!(f, "Plex {stage}: {source}"),
            Self::YouTube { stage, source } => write!(f, "YouTube {stage}: {source}"),
            Self::Other(msg) => write!(f, "{msg}"),
        }
    }
}

impl std::error::Error for NightingaleError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(e) => Some(e),
            Self::Json(e) => Some(e),
            Self::Database(source) => Some(source.as_ref()),
            Self::Jellyfin { source, .. } => Some(source.as_ref()),
            Self::Navidrome { source, .. } => Some(source.as_ref()),
            Self::Plex { source, .. } => Some(source.as_ref()),
            Self::YouTube { source, .. } => Some(source.as_ref()),
            Self::Other(_) => None,
        }
    }
}

impl NightingaleError {
    pub fn jellyfin<E>(stage: &'static str, source: E) -> Self
    where
        E: std::error::Error + Send + Sync + 'static,
    {
        Self::Jellyfin {
            stage,
            source: Box::new(source),
        }
    }

    pub fn navidrome<E>(stage: &'static str, source: E) -> Self
    where
        E: std::error::Error + Send + Sync + 'static,
    {
        Self::Navidrome {
            stage,
            source: Box::new(source),
        }
    }

    pub fn plex<E>(stage: &'static str, source: E) -> Self
    where
        E: std::error::Error + Send + Sync + 'static,
    {
        Self::Plex {
            stage,
            source: Box::new(source),
        }
    }
}

impl NightingaleError {
    pub fn youtube<E>(stage: &'static str, source: E) -> Self
    where
        E: std::error::Error + Send + Sync + 'static,
    {
        Self::YouTube {
            stage,
            source: Box::new(source),
        }
    }
}

impl From<std::io::Error> for NightingaleError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl From<serde_json::Error> for NightingaleError {
    fn from(e: serde_json::Error) -> Self {
        Self::Json(e)
    }
}

impl From<diesel::result::Error> for NightingaleError {
    fn from(e: diesel::result::Error) -> Self {
        Self::Database(Box::new(e))
    }
}

impl From<diesel::ConnectionError> for NightingaleError {
    fn from(e: diesel::ConnectionError) -> Self {
        Self::Database(Box::new(e))
    }
}

impl From<String> for NightingaleError {
    fn from(s: String) -> Self {
        Self::Other(s)
    }
}

impl From<&str> for NightingaleError {
    fn from(s: &str) -> Self {
        Self::Other(s.to_string())
    }
}

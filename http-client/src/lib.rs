mod delete;
mod read;
mod write;

use protocol::Namespace;

pub struct Client {
    base_url: String,
    http: reqwest::Client,
}

impl Client {
    pub fn new(base_url: &str) -> Self {
        Client {
            base_url: base_url.trim_end_matches('/').to_string(),
            http: reqwest::Client::new(),
        }
    }

    fn url(&self, namespace: &Namespace, object: &str, relation: &str, subject: &str) -> String {
        format!(
            "{}/v1/{}/{}/{}/{}",
            self.base_url, namespace, object, relation, subject
        )
    }
}

#[derive(Debug)]
pub enum Error {
    Request(reqwest::Error),
    Status(reqwest::StatusCode, Option<String>),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Request(e) => write!(f, "request error: {e}"),
            Error::Status(code, body) => {
                write!(f, "HTTP {code}")?;
                if let Some(body) = body {
                    write!(f, ": {body}")?;
                }
                Ok(())
            }
        }
    }
}

impl std::error::Error for Error {}

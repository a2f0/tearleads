use protocol::Namespace;
use store::Tuple;

use crate::{Client, Error};

impl Client {
    pub async fn read(
        &self,
        namespace: &Namespace,
        object: &str,
        relation: &str,
        subject: &str,
    ) -> Result<Option<Tuple>, Error> {
        let resp = self
            .http
            .get(self.url(namespace, object, relation, subject))
            .send()
            .await
            .map_err(Error::Request)?;

        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }

        if !resp.status().is_success() {
            return Err(Error::Status(resp.status(), resp.text().await.ok()));
        }

        let tuple: Tuple = resp.json().await.map_err(Error::Request)?;
        Ok(Some(tuple))
    }
}

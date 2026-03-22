use protocol::Namespace;

use crate::{Client, Error};

impl Client {
    pub async fn delete(
        &self,
        namespace: &Namespace,
        object: &str,
        relation: &str,
        subject: &str,
    ) -> Result<bool, Error> {
        let resp = self
            .http
            .delete(self.url(namespace, object, relation, subject))
            .send()
            .await
            .map_err(Error::Request)?;

        if !resp.status().is_success() {
            return Err(Error::Status(resp.status(), resp.text().await.ok()));
        }

        let body: serde_json::Value = resp.json().await.map_err(Error::Request)?;
        Ok(body["deleted"].as_bool().unwrap_or(false))
    }
}

use protocol::Namespace;

use crate::{Client, Error};

impl Client {
    pub async fn write(
        &self,
        namespace: &Namespace,
        object: &str,
        relation: &str,
        subject: &str,
        payload: &[u8],
    ) -> Result<(), Error> {
        let resp = self
            .http
            .put(self.url(namespace, object, relation, subject))
            .body(payload.to_vec())
            .send()
            .await
            .map_err(Error::Request)?;

        if resp.status().is_success() {
            Ok(())
        } else {
            Err(Error::Status(resp.status(), resp.text().await.ok()))
        }
    }
}

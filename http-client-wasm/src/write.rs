use wasm_bindgen::prelude::*;

use crate::{Client, Error};

#[wasm_bindgen]
impl Client {
    pub async fn write(
        &self,
        namespace: &str,
        object: &str,
        relation: &str,
        subject: &str,
        payload: &[u8],
    ) -> Result<(), JsValue> {
        let namespace = namespace.parse().map_err(|e: String| JsValue::from_str(&e))?;

        let resp = self
            .http
            .put(self.url(&namespace, object, relation, subject))
            .body(payload.to_vec())
            .send()
            .await
            .map_err(Error::Request)?;

        if resp.status().is_success() {
            Ok(())
        } else {
            Err(Error::Status(resp.status(), resp.text().await.ok()).into())
        }
    }
}

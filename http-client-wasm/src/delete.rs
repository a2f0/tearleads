use wasm_bindgen::prelude::*;

use crate::{Client, Error};

#[wasm_bindgen]
impl Client {
    pub async fn delete(
        &self,
        namespace: &str,
        object: &str,
        relation: &str,
        subject: &str,
    ) -> Result<bool, JsValue> {
        let namespace = namespace.parse().map_err(|e: String| JsValue::from_str(&e))?;

        let resp = self
            .http
            .delete(self.url(&namespace, object, relation, subject))
            .send()
            .await
            .map_err(Error::Request)?;

        if !resp.status().is_success() {
            return Err(Error::Status(resp.status(), resp.text().await.ok()).into());
        }

        let body: serde_json::Value = resp.json().await.map_err(Error::Request)?;
        Ok(body.get("deleted").and_then(|v| v.as_bool()).unwrap_or(false))
    }
}

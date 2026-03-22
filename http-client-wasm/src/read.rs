use wasm_bindgen::prelude::*;

use crate::{Client, Error};

#[wasm_bindgen]
impl Client {
    pub async fn read(
        &self,
        namespace: &str,
        object: &str,
        relation: &str,
        subject: &str,
    ) -> Result<JsValue, JsValue> {
        let namespace = namespace.parse().map_err(|e: String| JsValue::from_str(&e))?;

        let resp = self
            .http
            .get(self.url(&namespace, object, relation, subject))
            .send()
            .await
            .map_err(Error::Request)?;

        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(JsValue::NULL);
        }

        if !resp.status().is_success() {
            return Err(Error::Status(resp.status(), resp.text().await.ok()).into());
        }

        let tuple: store::Tuple = resp.json().await.map_err(Error::Request)?;
        let js = serde_wasm_bindgen::to_value(&tuple)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        Ok(js)
    }
}

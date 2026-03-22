use wasm_bindgen::prelude::*;

use crate::{Client, to_js_err};

#[wasm_bindgen]
impl Client {
    pub async fn write(
        &self,
        namespace: &str,
        object: &str,
        relation: &str,
        subject: &str,
        payload: Vec<u8>,
    ) -> Result<(), JsValue> {
        let namespace = namespace.parse().map_err(|e: String| JsValue::from_str(&e))?;
        self.inner
            .write(&namespace, object, relation, subject, &payload)
            .await
            .map_err(to_js_err)
    }
}

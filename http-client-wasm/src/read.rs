use store::Tuple;
use wasm_bindgen::prelude::*;

use crate::{Client, to_js_err};

#[wasm_bindgen]
impl Client {
    pub async fn read(
        &self,
        namespace: &str,
        object: &str,
        relation: &str,
        subject: &str,
    ) -> Result<Option<Tuple>, JsValue> {
        let namespace = namespace.parse().map_err(|e: String| JsValue::from_str(&e))?;
        self.inner
            .read(&namespace, object, relation, subject)
            .await
            .map_err(to_js_err)
    }
}

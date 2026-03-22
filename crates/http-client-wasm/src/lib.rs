mod delete;
mod read;
mod write;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Client {
    inner: http_client::Client,
}

#[wasm_bindgen]
impl Client {
    #[wasm_bindgen(constructor)]
    pub fn new(base_url: &str) -> Self {
        Client {
            inner: http_client::Client::new(base_url),
        }
    }
}

fn to_js_err(e: http_client::Error) -> JsValue {
    JsValue::from_str(&e.to_string())
}

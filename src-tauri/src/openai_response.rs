//! Parse OpenAI Responses API payloads (function calls and assistant text).

use serde_json::Value;

#[derive(Debug)]
pub struct ToolCall {
    pub name: String,
    pub arguments: Value,
}

pub fn extract_function_calls(response: &Value) -> Vec<ToolCall> {
    response
        .get("output")
        .and_then(|output| output.as_array())
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let item_type = item.get("type")?.as_str()?;
            if item_type != "function_call" {
                return None;
            }
            let name = item.get("name")?.as_str()?.to_string();
            let raw_args = item.get("arguments")?.as_str()?;
            let arguments = serde_json::from_str(raw_args).ok()?;
            Some(ToolCall { name, arguments })
        })
        .collect()
}

pub fn extract_output_text(response: &Value) -> Option<String> {
    if let Some(text) = response.get("output_text").and_then(|value| value.as_str()) {
        return Some(text.to_string());
    }
    let mut output = String::new();
    for item in response.get("output")?.as_array()? {
        if item.get("type").and_then(|value| value.as_str()) != Some("message") {
            continue;
        }
        for content in item
            .get("content")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
        {
            let kind = content
                .get("type")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            if kind != "output_text" {
                continue;
            }
            if let Some(text) = content.get("text").and_then(|value| value.as_str()) {
                output.push_str(text);
            }
        }
    }
    if output.is_empty() {
        None
    } else {
        Some(output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_output_text_filters_to_output_text_type() {
        let response = serde_json::json!({
            "output": [
                { "type": "function_call", "name": "create_box", "arguments": "{}" },
                {
                    "type": "message",
                    "content": [
                        { "type": "reasoning", "text": "internal thinking" },
                        { "type": "output_text", "text": "Hello!" }
                    ]
                }
            ]
        });
        assert_eq!(extract_output_text(&response).as_deref(), Some("Hello!"));
    }
}

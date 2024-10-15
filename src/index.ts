import { LLM } from "@deskai/api";

const commonHeaders = new Headers();
commonHeaders.append("Content-Type", "application/json");

function extractToolCall(text: string): string | null {
  const regex = /<tool_call>(.*?)<\/tool_call>/s;
  const match = text.match(regex);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
}

async function getModels() {
  const models = await fetch("http://localhost:11434/api/tags").then((res) =>
    res.json()
  );
  return models.models.map((model) => ({
    label: model.name as string,
    value: model.name as string,
  }));
}

export default class {
  private _model: string;
  private _embeddingModel: string;
  constructor() {
    this._model = "qwen2.5:7b";
    this._embeddingModel = "nomic-embed-text:latest";
    LLM.addLLMProvider({
      name: "ollama",
      description: "Get up and running with large language models.",
      configSchema: {
        type: "object",
        properties: {
          model: {
            type: "dynamic-enum",
            title: "Chat Model",
            dynamicHandler: async () => {
              return await getModels().then((res) => {
                const selectObj = {
                  enum: [] as string[],
                  enumNames: [] as string[],
                };
                res.forEach((item) => {
                  selectObj.enum.push(item.value);
                  selectObj.enumNames.push(item.label);
                });
                return selectObj;
              });
            },
          },
        },
      },
      defaultConfig: {
        model: "qwen2.5:7b",
      },
      icon: "https://github.com/ollama/ollama/assets/3325447/0d0b44e2-8f4a-4e99-9b52-a5c1c741c8f7",
      getModels,
      loadConfig(config) {
        this._model = config.model;
      },
      setConfig(key, value) {
        if (key === "model") {
          this._model = value;
        }
      },
      async chat(content: any[], options: any) {
        const baseURL = `http://localhost:11434/api/chat`;
        const stream = options?.stream ?? true;
        const model = options?.model || this._model;
        content.forEach((item) => {
          if (item.tool_calls) {
            item.tool_calls.forEach((tool) => {
              if (tool.function.arguments) {
                tool.function.arguments = JSON.parse(tool.function.arguments);
              }
            });
          }
        });
        const response = await fetch(baseURL, {
          method: "POST",
          headers: commonHeaders,
          body: JSON.stringify({
            messages: content,
            model: options?.model || this._model,
            stream,
            tools: options?.tools,
          }),
        });
        if (!response.ok) {
          return response;
        }
        if (!stream) {
          const data = await response.json();
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(data.message);
                controller.close();
              },
            }),
            {
              headers: {
                "Content-Type": "application/json",
                model: this._model,
              },
            }
          );
        }
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        const chunks: Record<string, any> = {
          role: "assistant",
          content: "",
        };
        return new Response(
          new ReadableStream({
            async start(controller) {
              const read = async () => {
                try {
                  const { done, value } = await reader.read();
                  let current = decoder.decode(value, { stream: true });
                  if (done) {
                    try {
                      const content =
                        extractToolCall(chunks.content) || chunks.content;
                      const tryTool = JSON.parse(content);
                      if (
                        tryTool.name &&
                        (tryTool.parameters || tryTool.arguments) &&
                        options?.tools.find(
                          (item) => item.function.name === tryTool.name
                        )
                      ) {
                        controller.enqueue({
                          ...chunks,
                          tool_calls: [
                            {
                              type: "function",
                              id: +new Date(),
                              function: {
                                name: tryTool.name,
                                arguments:
                                  tryTool.parameters || tryTool.arguments,
                              },
                            },
                          ],
                        });
                      }
                    } catch (e) {}
                    controller.close();
                    return;
                  }
                  current = current.trim();
                  try {
                    const messageObject = JSON.parse(current);
                    if (messageObject.message?.role) {
                      chunks.role = messageObject.message.role;
                    }
                    if (messageObject.message?.content) {
                      chunks.content += messageObject.message.content;
                    }
                    controller.enqueue(chunks);
                  } catch (e) {
                    console.log(e);
                  }
                  await read();
                } catch (error) {
                  console.log(error);
                  controller.error(error);
                  controller.close();
                }
              };
              await read();
            },
          }),
          {
            status: 200,
            statusText: "OK",
            headers: {
              model: model,
              "Content-Type": stream ? "text/event-stream" : "application/json",
            },
          }
        );
      },
    });

    // @ts-ignore
    LLM.addEmbeddingProvider({
      name: "ollama",
      description: "Get up and running with large language models.",
      configSchema: {
        type: "object",
        properties: {
          model: {
            type: "dynamic-enum",
            title: "Embedding Model",
            dynamicHandler: async () => {
              return await getModels().then((res) => {
                const selectObj = {
                  enum: [] as string[],
                  enumNames: [] as string[],
                };
                res.forEach((item) => {
                  selectObj.enum.push(item.value);
                  selectObj.enumNames.push(item.label);
                });
                return selectObj;
              });
            },
          },
        },
      },
      defaultConfig: {
        model: "nomic-embed-text:latest",
      },
      icon: "https://github.com/ollama/ollama/assets/3325447/0d0b44e2-8f4a-4e99-9b52-a5c1c741c8f7",
      getModels,
      loadConfig(config) {
        this._embeddingModel = config.model;
      },
      setConfig(key, value) {
        if (key === "model") {
          this._embeddingModel = value;
        }
      },
      async embed(input: string, options: any) {
        const baseURL = `http://localhost:11434/api/embed`;
        const response = await fetch(baseURL, {
          method: "POST",
          headers: commonHeaders,
          body: JSON.stringify({
            input: [input],
            model: options?.model || this._embeddingModel,
          }),
        }).then((res) => res.json());
        return {
          model: response.model,
          embeddings: response.embeddings[0],
          length: response.embeddings[0].length,
        };
      },
    });
  }
}

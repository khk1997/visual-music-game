import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.error("Missing OPENAI_API_KEY. Set it in your terminal before running.");
  process.exit(1);
}

const client = new OpenAI({ apiKey });

const response = await client.responses.create({
  model: "gpt-5",
  input: "請用繁體中文做一句簡短自我介紹。",
});

console.log(response.output_text);

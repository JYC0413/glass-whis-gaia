const OpenAI = require('openai');
const WebSocket = require('ws');
const FormData = require('form-data');
const fetch = require('node-fetch');

/**
 * Whisper STT session工厂
 * @param {object} opts - 配置项
 * @returns {Promise<object>} - 带transcribe方法的session对象
 */
async function createSTT(opts) {
  const {
    apiUrl,
    apiKey,
    language = 'en',
    model = 'whisper-1',
    contentType = 'audio/wav',
    filename = 'audio.wav',
    prompt
  } = opts || {};

  // 返回session对象
  return {
    /**
     * 发送音频buffer到Whisper，返回识别结果
     * @param {Buffer} audioBuffer
     * @returns {Promise<object>} { text: ... }
     */
    async transcribe(audioBuffer) {
      if (!audioBuffer || !Buffer.isBuffer(audioBuffer)) {
        throw new Error('audioBuffer (Buffer) is required');
      }
      const form = new FormData();
      form.append('file', audioBuffer, { filename, contentType });
      form.append('model', model);
      if (language) form.append('language', language);
      if (prompt) form.append('prompt', prompt);

      console.log(`[Whisper] Transcribing audio with model: ${model}, language: ${language}, prompt: ${prompt || 'none'}`);

      const response = await fetch('http://35.238.174.232:9080/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          ...form.getHeaders()
        },
        body: form
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Whisper API error: ${response.status} ${response.statusText} - ${err}`);
      }
      console.log(`[Whisper] Transcription successful: ${response.status}`);
      return await response.json();
    },
    /**
     * transcribeAudio: 兼容sttService的调用，等价于transcribe
     * @param {Buffer} audioBuffer
     * @returns {Promise<object>}
     */
    async transcribeAudio(audioBuffer) {
      return this.transcribe(audioBuffer);
    },
    // 兼容接口
    close() { /* 可选: 释放资源 */ }
  };
}

/**
 * Creates an OpenAI LLM instance
 * @param {object} opts - Configuration options
 * @param {string} opts.apiKey - OpenAI API key
 * @param {string} [opts.model='gpt-4.1'] - Model name
 * @param {number} [opts.temperature=0.7] - Temperature
 * @param {number} [opts.maxTokens=2048] - Max tokens
 * @param {boolean} [opts.usePortkey=false] - Whether to use Portkey
 * @param {string} [opts.portkeyVirtualKey] - Portkey virtual key
 * @returns {object} LLM instance
 */
function createLLM({ apiKey, model = 'gpt-4.1', temperature = 0.7, maxTokens = 2048, usePortkey = false, portkeyVirtualKey, ...config }) {
  const client = new OpenAI({ apiKey });
  
  const callApi = async (messages) => {
    if (!usePortkey) {
      const response = await client.chat.completions.create({
        model: model,
        messages: messages,
        temperature: temperature,
        max_tokens: maxTokens
      });
      return {
        content: response.choices[0].message.content.trim(),
        raw: response
      };
    } else {
      const fetchUrl = 'https://api.portkey.ai/v1/chat/completions';
      const response = await fetch(fetchUrl, {
        method: 'POST',
        headers: {
            'x-portkey-api-key': 'gRv2UGRMq6GGLJ8aVEB4e7adIewu',
            'x-portkey-virtual-key': portkeyVirtualKey || apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: model,
            messages,
            temperature,
            max_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        throw new Error(`Portkey API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      return {
        content: result.choices[0].message.content.trim(),
        raw: result
      };
    }
  };

  return {
    generateContent: async (parts) => {
      const messages = [];
      let systemPrompt = '';
      let userContent = [];
      
      for (const part of parts) {
        if (typeof part === 'string') {
          if (systemPrompt === '' && part.includes('You are')) {
            systemPrompt = part;
          } else {
            userContent.push({ type: 'text', text: part });
          }
        } else if (part.inlineData) {
          userContent.push({
            type: 'image_url',
            image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` }
          });
        }
      }
      
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      if (userContent.length > 0) messages.push({ role: 'user', content: userContent });
      
      const result = await callApi(messages);

      return {
        response: {
          text: () => result.content
        },
        raw: result.raw
      };
    },
    
    // For compatibility with chat-style interfaces
    chat: async (messages) => {
      return await callApi(messages);
    }
  };
}

/**
 * Creates an OpenAI streaming LLM instance
 * @param {object} opts - Configuration options
 * @param {string} opts.apiKey - OpenAI API key
 * @param {string} [opts.model='gpt-4.1'] - Model name
 * @param {number} [opts.temperature=0.7] - Temperature
 * @param {number} [opts.maxTokens=2048] - Max tokens
 * @param {boolean} [opts.usePortkey=false] - Whether to use Portkey
 * @param {string} [opts.portkeyVirtualKey] - Portkey virtual key
 * @returns {object} Streaming LLM instance
 */
function createStreamingLLM({ apiUrl, apiKey, model = '', temperature = 0.7, maxTokens = 2048, usePortkey = false, portkeyVirtualKey, ...config }) {
  return {
    streamChat: async (messages) => {
      const headers = {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          };

      const finalApiUrl = apiUrl.endsWith('/v1/chat/completions') ? apiUrl : `${apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl}/v1/chat/completions`;

      console.log(finalApiUrl)

      const response = await fetch(finalApiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Gaia API error: ${response.status} ${response.statusText}`);
      }

      return response;
    }
  };
}

module.exports = {
  createSTT,
  createLLM,
  createStreamingLLM
};

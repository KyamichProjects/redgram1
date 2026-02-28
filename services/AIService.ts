/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI } from "@google/genai";
import { Message } from "./ChatSocket";

export class AIService {
  private ai: GoogleGenAI;
  private modelId = 'gemini-2.5-flash';

  constructor() {
    // Assuming process.env.API_KEY is available in the environment
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  async generateResponse(
    history: Message[], 
    userPrompt: string, 
    personaName: string,
    personaBio: string
  ): Promise<string> {
    try {
      // Convert app message history to Gemini format
      // Taking last 10 messages for context to save tokens
      const recentHistory = history.slice(-10).map(msg => ({
        role: msg.sender === 'me' ? 'user' : 'model',
        parts: [{ text: msg.text }]
      }));

      // Create a dynamic system instruction based on the contact's profile
      const systemInstruction = `
        You are a roleplaying character in a chat app. 
        Your name is "${personaName}".
        Your bio/personality is: "${personaBio}".
        
        Rules:
        1. Act exactly like this person. 
        2. Keep your answers relatively short and conversational, like a real Telegram message.
        3. Do not sound like an AI assistant unless your character IS an AI assistant.
        4. If you are a family member, be affectionate. If you are a celebrity, be charismatic.
      `;

      const response = await this.ai.models.generateContent({
        model: this.modelId,
        contents: [
            ...recentHistory,
            { role: 'user', parts: [{ text: userPrompt }] }
        ],
        config: {
          systemInstruction: systemInstruction,
        }
      });

      return response.text || "...";
    } catch (error) {
      console.error("AI Generation Error:", error);
      return "Error: Network unreachable.";
    }
  }
}
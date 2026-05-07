import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function loadPrompt(name: string, variables: Record<string, string> = {}): Promise<string> {
  const path = resolve(process.cwd(), 'src/prompts', name);
  let template = await readFile(path, 'utf8');
  for (const [key, value] of Object.entries(variables)) {
    template = template.replaceAll(`{${key}}`, value);
  }
  return template;
}

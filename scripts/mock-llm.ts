// 手元の確認用に、にせのLLMを起動する。接続先に http://127.0.0.1:5599/v1（種類: OpenAI互換）を入れて使う
// 2つ目の引数で、ストリーミングで送る間隔（ミリ秒）を変えられる。例 node scripts/mock-llm.ts 5599 80
import { startMockLlm } from '../server/test/mockLlm.ts';

const port = Number(process.argv[2] ?? 5599);
const { url, stream } = await startMockLlm(port);
stream.delayMs = Number(process.argv[3] ?? 40);
console.log(`mock LLM: ${url}`);

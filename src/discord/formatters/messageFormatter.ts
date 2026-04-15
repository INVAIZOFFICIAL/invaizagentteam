// Discord 메시지 2000자 제한 처리
export function splitMessage(text: string, maxLength = 1900): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    // 마지막 줄바꿈 기준으로 분할
    const chunk = remaining.slice(0, maxLength);
    const lastNewline = chunk.lastIndexOf('\n');
    const splitAt = lastNewline > maxLength / 2 ? lastNewline : maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

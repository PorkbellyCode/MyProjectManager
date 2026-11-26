"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 화면 낭독기용 상시 알림 영역(aria-live). 폴링·새로 고침으로 카드나 상태가 바뀌면 `message`를 한 번 읽어 준다.
 * 처음 그릴 때는 읽지 않는다(이미 화면에 있는 내용). 영역 자체는 늘 DOM에 있어야 낭독기가 변화를 잡는다.
 */
export function LiveAnnouncer({ message }: { message: string }) {
  const first = useRef(message);
  const [text, setText] = useState("");

  useEffect(() => {
    if (message === first.current) return;
    first.current = message;
    // 같은 문구가 다시 와도 읽히도록 비웠다가 채운다.
    setText("");
    const id = window.setTimeout(() => setText(message), 50);
    return () => window.clearTimeout(id);
  }, [message]);

  return (
    <div aria-live="polite" aria-atomic="true" role="status" aria-label="티켓 변경 안내" className="sr-only">
      {text}
    </div>
  );
}

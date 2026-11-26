import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * 티켓 본문·댓글·정리본의 마크다운을 안전하게 그린다.
 * - react-markdown은 HTML을 실행하지 않는다(rehype-raw 없음). 본문 속 HTML 태그는 `skipHtml`로 아예 버린다.
 * - 링크는 defaultUrlTransform(http/https/mailto/상대 경로만 통과, `javascript:` 등은 빈 값)으로 거르고, 새 창 + noopener.
 * - 이미지는 우리 파일 경로(`/api/files/…`)와 https만 그린다. 그 밖은 대체 텍스트만 보인다.
 * 서버 컴포넌트에서도, 클라이언트 컴포넌트에서도 쓸 수 있다.
 */
export function MarkdownView({ source, className }: { source: string; className?: string }) {
  return (
    <div className={cn("mpm-prose", className)}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url, key) => {
          const safe = defaultUrlTransform(url);
          if (key === "src" && !(safe.startsWith("/api/files/") || safe.startsWith("https://"))) return "";
          return safe;
        }}
        components={{
          a: ({ href, children }) =>
            href ? (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          // eslint-disable-next-line @next/next/no-img-element -- 사용자가 올린 이미지(크기 모름)
          img: ({ src, alt }) => (typeof src === "string" && src ? <img src={src} alt={alt ?? ""} loading="lazy" /> : <span>{alt}</span>),
        }}
      >
        {source}
      </Markdown>
    </div>
  );
}

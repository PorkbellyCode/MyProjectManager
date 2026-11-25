import type { Metadata } from "next";
import { IBM_Plex_Sans_KR, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { THEME_COOKIE } from "@/lib/theme/constants";
import "./globals.css";

// 한글 본문·제목은 IBM Plex Sans KR, 번호·시각·SHA·단축키는 JetBrains Mono (design-rules 5).
const plex = IBM_Plex_Sans_KR({
  variable: "--font-plex",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jb",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "MyProjectManager", template: "%s · MyProjectManager" },
  description: "요청을 접수하고 AI가 1차 검토를 돕는 프로젝트 관리 도구",
};

// 페인트 전에 테마를 정한다(깜빡임 방지). 쿠키는 savePreferencesAction이 사용자 설정과 같은 값으로 쓴다.
// 셸이 있는 화면은 서버가 사용자 설정으로 래퍼의 data-theme을 직접 정한다.
const themeScript = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]+)/);var p=m?m[1]:"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light")}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      data-theme="light"
      suppressHydrationWarning
      className={`${plex.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}

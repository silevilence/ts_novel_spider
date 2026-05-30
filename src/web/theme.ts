import { createTheme } from '@mantine/core';

/**
 * 「暖色纸质暗调 (Warm Paper Dark)」设计令牌体系
 *
 * 设计理念：暗灯下读纸质书的沉浸感 —— 深褐基底的暗色环境 +
 * 暖奶油色的"纸面"正文区，点缀琥珀金与暖铜色。
 */
export const theme = createTheme({
  // ── 色彩体系（覆盖 Mantine 默认 dark 调色板） ──
  colors: {
    // 自定义 brand 色阶：暖橙 #ff8c42 的 10 阶变体
    brand: [
      '#fff1e8', '#ffe4d1', '#ffc9a3', '#ffad75',
      '#ff9247', '#ff8c42', '#e06b2f', '#b84d1f',
      '#8f3411', '#661d06',
    ],
    // 暖纸色阶：正文"纸面"色
    paper: [
      '#fdf8f2', '#faf1e4', '#f0e6d8', '#e8d5c0',
      '#d4bba0', '#c0a080', '#a88560', '#906b45',
      '#785530', '#604020',
    ],
    // 深褐背景色阶：环境底色
    warm: [
      '#f0e6d8', '#d4bba0', '#a88560', '#785530',
      '#4a2e18', '#3d2b1a', '#2c1e12', '#1f1510',
      '#1a1410', '#0f0a08',
    ],
    dark: [
      '#c9c9c9', '#b8b8b8', '#828282', '#696969',
      '#424242', '#3b3b3b', '#2e2e2e', '#242424',
      '#1f1f1f', '#141414',
    ],
  },

  // 主强调色指向 brand 色阶
  primaryColor: 'brand',
  primaryShade: { light: 5, dark: 5 },

  // ── 排版 ──
  fontFamily:
    '"IBM Plex Sans", "Segoe UI", "PingFang SC", "Noto Sans SC", sans-serif',
  fontFamilyMonospace:
    '"JetBrains Mono", "Cascadia Code", "Fira Code", monospace',
  headings: {
    fontFamily:
      '"Alegreya", "Noto Serif SC", Georgia, "Times New Roman", serif',
    fontWeight: '700',
    sizes: {
      h1: { fontSize: 'clamp(2.2rem, 4vw, 4.4rem)', lineHeight: '1.05' },
      h2: { fontSize: '1.6rem', lineHeight: '1.15' },
      h3: { fontSize: '1.25rem', lineHeight: '1.2' },
      h4: { fontSize: '1.1rem', lineHeight: '1.25' },
      h5: { fontSize: '1rem', lineHeight: '1.3' },
      h6: { fontSize: '0.9rem', lineHeight: '1.35' },
    },
  },
  fontSizes: {
    xs: '0.78rem',
    sm: '0.88rem',
    md: '1rem',
    lg: '1.12rem',
    xl: '1.28rem',
  },
  lineHeights: { xs: '1.35', sm: '1.4', md: '1.5', lg: '1.6', xl: '1.7' },

  // ── 圆角 ──
  radius: {
    xs: '6px',
    sm: '10px',
    md: '14px',
    lg: '18px',
    xl: '24px',
  },
  defaultRadius: 'md',

  // ── 间距（对齐 8px 基准） ──
  spacing: {
    xs: '0.5rem',
    sm: '0.75rem',
    md: '1rem',
    lg: '1.25rem',
    xl: '1.75rem',
  },

  // ── 阴影（暖色调，替代冷蓝投影） ──
  shadows: {
    xs: '0 1px 3px rgba(15, 10, 8, 0.3)',
    sm: '0 4px 12px rgba(15, 10, 8, 0.35)',
    md: '0 12px 32px rgba(15, 10, 8, 0.4)',
    lg: '0 20px 60px rgba(15, 10, 8, 0.45)',
    xl: '0 32px 90px rgba(10, 6, 4, 0.5)',
  },

  // ── 组件级默认值 ──
  components: {
    Button: {
      defaultProps: { radius: 'xl' },
      styles: {
        root: { fontWeight: 600, letterSpacing: '0.01em' },
      },
    },
    Card: {
      defaultProps: { radius: 'lg', shadow: 'sm' },
      styles: {
        root: {
          backgroundColor: 'rgba(31, 21, 16, 0.84)',
          borderColor: 'rgba(168, 133, 96, 0.18)',
        },
      },
    },
    Paper: {
      styles: {
        root: {
          backgroundColor: 'rgba(31, 21, 16, 0.84)',
          borderColor: 'rgba(168, 133, 96, 0.18)',
        },
      },
    },
    Badge: {
      defaultProps: { variant: 'light' },
    },
    Input: {
      styles: {
        input: {
          backgroundColor: 'rgba(10, 6, 4, 0.7)',
          borderColor: 'rgba(168, 133, 96, 0.2)',
        },
      },
    },
    Modal: {
      styles: {
        header: {
          backgroundColor: 'rgba(31, 21, 16, 0.96)',
          borderBottom: '1px solid rgba(168, 133, 96, 0.14)',
        },
        body: {
          backgroundColor: 'rgba(26, 20, 16, 0.94)',
        },
      },
    },
    Accordion: {
      styles: {
        control: {
          minHeight: '48px',
          paddingLeft: '1rem',
          paddingRight: '1rem',
        },
        panel: {
          padding: '0.75rem 1rem',
        },
      },
    },
    Tooltip: {
      defaultProps: {
        withArrow: true,
      },
    },
  },

  // ── 扩展令牌（供 CSS 和组件通过 useMantineTheme 访问） ──
  other: {
    accentStrong: '#ffd166',
    accentCopper: '#c77d5a',
    successColor: '#61d4a6',
    warningColor: '#ffd166',
    dangerColor: '#ff7b72',
    bgDeepest: '#0f0a08',
    bgBase: '#1a1410',
    bgPanel: 'rgba(31, 21, 16, 0.84)',
    bgPanelStrong: 'rgba(38, 26, 20, 0.94)',
    inkMuted: '#a89b8c',
    lineColor: 'rgba(168, 133, 96, 0.18)',
    lineStrong: 'rgba(168, 133, 96, 0.28)',
    panelBlur: 'blur(18px)',
    focusRing: '2px solid rgba(255, 140, 66, 0.6)',
  },
});

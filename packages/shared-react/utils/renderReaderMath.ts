import renderMathInElement from "katex/contrib/auto-render";

/**
 * Render TeX/LaTeX delimiters inside reader HTML with KaTeX.
 * Stored bookmark HTML has scripts stripped, so MathJax/KaTeX from the
 * original page never runs — this restores math for common delimiters.
 */
export function renderReaderMath(element: HTMLElement): void {
  try {
    renderMathInElement(element, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        {
          left: "\\begin{equation}",
          right: "\\end{equation}",
          display: true,
        },
        { left: "\\begin{align}", right: "\\end{align}", display: true },
        { left: "\\begin{align*}", right: "\\end{align*}", display: true },
        { left: "\\(", right: "\\)", display: false },
        // Keep `$` after `$$` so empty $$ isn't matched as inline.
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
      strict: "ignore",
      trust: false,
      ignoredTags: [
        "script",
        "noscript",
        "style",
        "textarea",
        "pre",
        "code",
        "option",
      ],
    });
  } catch {
    // Best effort — leave raw TeX visible if rendering fails.
  }
}

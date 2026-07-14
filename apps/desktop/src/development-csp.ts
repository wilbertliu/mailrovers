const strictStylePolicy = "style-src 'self'"
const developmentStylePolicy = "style-src 'self' 'unsafe-inline'"

export function allowDevelopmentStyles(html: string): string {
  return html.replace(strictStylePolicy, developmentStylePolicy)
}

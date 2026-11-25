export interface LegalDocumentProps {
  /**
   * Prefixes every section and heading id, so a page that shows a document
   * more than once (a split view, say) keeps its ids unique. The website
   * leaves it empty, keeping ids such as `retention` that its table of
   * contents and other pages link to.
   */
  readonly idPrefix?: string | undefined;
  /**
   * Resolves a link to another page of the website, written as its
   * site-relative path (`/terms-of-service/`). The website keeps the path; an
   * app, which the website does not serve, resolves it to the website's
   * absolute address.
   */
  readonly siteHref?: ((path: string) => string) | undefined;
}

/** What each part of a document renders its sections with. */
export interface LegalDocumentSectionProps {
  readonly id: (name: string) => string;
  readonly siteHref: (path: string) => string;
}

export function legalDocumentSectionProps({
  idPrefix = "",
  siteHref = (path) => path,
}: LegalDocumentProps): LegalDocumentSectionProps {
  return { id: (name) => `${idPrefix}${name}`, siteHref };
}

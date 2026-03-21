import { load } from 'cheerio';

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const textFromParagraphs = ($: ReturnType<typeof load>): string => {
  const paragraphs = $('p')
    .map((_index, element) => normalizeText($(element).text()))
    .get()
    .filter((text) => text.length >= 20);

  if (paragraphs.length > 0) {
    return normalizeText(paragraphs.join('\n\n'));
  }

  return '';
};

export const parseArticleFields = (html: string): { title: string; content: string } => {
  const $ = load(html);
  $('script, style, noscript, nav, header, footer, svg').remove();

  const title =
    normalizeText($('meta[property="og:title"]').attr('content') || '') ||
    normalizeText($('h1').first().text() || '') ||
    normalizeText($('title').first().text() || '');

  const paragraphText = textFromParagraphs($);
  const bodyText = paragraphText || normalizeText($('body').text() || '');

  return {
    title,
    content: bodyText
  };
};

export default parseArticleFields;

import { serializeJsonLd } from "../game-data/seo";

export function JsonLd({ data }: Readonly<{ data: object }>) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}

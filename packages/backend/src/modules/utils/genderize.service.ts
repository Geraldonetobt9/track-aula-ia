import { BadRequestException, Injectable, Logger } from '@nestjs/common';

@Injectable()
export class GenderizeService {
  private readonly logger = new Logger(GenderizeService.name);

  async genderize(
    names: string[],
  ): Promise<Record<string, { gender: string; probability: number }>> {
    if (!Array.isArray(names) || names.length === 0) {
      throw new BadRequestException('names array required');
    }

    // Extract unique first names
    const uniqueFirstNames = [
      ...new Set(
        names
          .filter((n: string) => n && typeof n === 'string')
          .map((n: string) => n.trim().split(/\s+/)[0].toLowerCase()),
      ),
    ] as string[];

    // Cap at 100 unique names to avoid rate limits on genderize.io free tier
    const cappedNames = uniqueFirstNames.slice(0, 100);

    const results: Record<string, { gender: string; probability: number }> = {};
    const batchSize = 10;

    for (let i = 0; i < cappedNames.length; i += batchSize) {
      const batch = cappedNames.slice(i, i + batchSize);
      const params = batch
        .map((n, idx) => `name[${idx}]=${encodeURIComponent(n)}`)
        .join('&');
      const url = `https://api.genderize.io?${params}&country_id=BR`;

      try {
        const resp = await fetch(url);
        if (!resp.ok) {
          this.logger.error(
            `genderize.io error: ${resp.status} ${await resp.text()}`,
          );
          continue;
        }

        const data = await resp.json();
        (Array.isArray(data) ? data : [data]).forEach((item: any) => {
          if (item.name && item.gender) {
            results[item.name.toLowerCase()] = {
              gender: item.gender,
              probability: item.probability || 0,
            };
          }
        });
      } catch (err) {
        this.logger.error(`genderize.io fetch error: ${err}`);
        continue;
      }

      // Small delay between batches to respect rate limits
      if (i + batchSize < cappedNames.length) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    return results;
  }
}

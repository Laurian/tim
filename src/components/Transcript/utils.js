import unicode from 'unicode-regex';
import { WebVTT } from 'videojs-vtt.js';
import { parseSync as SRTParser } from 'subtitle';

const punctuation = unicode({ General_Category: ['Punctuation'] }).toRegExp();

export const parse = (data, format) => {
  switch (format) {
    case 'google':
      return new Promise((resolve, reject) => {
        try {
          const { results } = JSON.parse(data);

          resolve(
            results
              .map(({ alternatives: [{ transcript: text, words }] }) => ({
                text,
                items: words.map(
                  ({
                    word: text,
                    startTime: { seconds: startSeconds, nanos: startNanos = 0 },
                    endTime: { seconds: endSeconds, nanos: endNanos = 0 },
                  }) => ({
                    text,
                    start: parseInt(startSeconds, 10) + startNanos / 1e9,
                    end: parseInt(endSeconds) + endNanos / 1e9,
                  })
                ),
              }))
              .map(({ text, items }) => ({
                text,
                items,
                start: items[0]?.start,
                end: items[items.length - 1]?.end,
              }))
          );
        } catch (error) {
          reject(error);
        }
      });

    case 'amazon':
      return new Promise((resolve, reject) => {
        try {
          const {
            results: {
              speaker_labels: { segments },
              items,
            },
          } = JSON.parse(data);

          const convertedItems = items
            .map(({ start_time, end_time, alternatives: [{ content: text }], type }) => {
              const start = parseFloat(start_time, 10);
              const end = parseFloat(end_time, 10);

              return { text, start, end, type };
            })
            .reduce((acc, item) => {
              const { text, type } = item;
              if (type !== 'punctuation') return [...acc, item];

              const prev = acc.pop();
              prev.text += text;
              return [...acc, prev];
            }, []);

          resolve(
            segments.map(({ start_time, end_time }) => {
              const segmentStart = parseFloat(start_time, 10);
              const segmentEnd = parseFloat(end_time, 10);

              const segmentItems = convertedItems.filter(
                ({ start, end }) => segmentStart <= start && end <= segmentEnd
              );

              return {
                text: segmentItems.map(({ text }) => text).join(' '),
                start: segmentStart,
                end: segmentEnd,
                items: segmentItems,
              };
            })
          );
        } catch (error) {
          reject(error);
        }
      });

    case 'speechmatics':
      return new Promise((resolve, reject) => {
        try {
          const { speakers, words } = JSON.parse(data);

          const convertedWords = words
            .map(({ time, duration, name: text }) => {
              const start = parseFloat(time, 10);
              const end = start + parseFloat(duration, 10);

              return { text, start, end };
            })
            .reduce((acc, item) => {
              const { text } = item;
              if (text.length > 1 || !punctuation.test(text)) return [...acc, item];

              const prev = acc.pop();
              if (prev) prev.text += text;
              return [...acc, prev];
            }, []);

          resolve(
            speakers.map(({ time, duration }) => {
              const segmentStart = parseFloat(time, 10);
              const segmentEnd = segmentStart + parseFloat(duration, 10);

              const items = convertedWords.filter(({ start, end }) => segmentStart <= start && end <= segmentEnd);

              return {
                text: items.map(({ text }) => text).join(' '),
                start: segmentStart,
                end: segmentEnd,
                items,
              };
            })
          );
        } catch (error) {
          reject(error);
        }
      });

    case 'vtt':
      return new Promise((resolve, reject) => {
        try {
          const vttParser = new WebVTT.Parser(window, WebVTT.StringDecoder());
          const cues = [];

          vttParser.onparsingerror = error => reject(error);
          vttParser.oncue = cue => cues.push(cue);

          vttParser.onflush = () =>
            resolve(
              cues.map(({ text, startTime: start, endTime: end }) => ({
                text,
                start,
                end,
                items: text.split(' ').map(text => ({
                  text,
                  start,
                  end,
                })),
              }))
            );

          vttParser.parse(data);
          vttParser.flush();
        } catch (error) {
          reject(error);
        }
      });

    case 'srt':
      return new Promise((resolve, reject) => {
        try {
          resolve(
            SRTParser(data)
              .filter(({ type }) => type === 'cue')
              .map(({ data: { text, start, end } }) => ({
                text,
                start: start / 1e3,
                end: end / 1e3,
                items: text.split(' ').map(text => ({
                  text,
                  start,
                  end,
                })),
              }))
          );
        } catch (error) {
          reject(error);
        }
      });
    default:
      console.warn('format not handled', format);
      throw new Error('format not handled');
  }
};
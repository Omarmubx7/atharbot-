const { HTUAssistant } = require('../utils');

describe('HTUAssistant basic', () => {
  let a;
  beforeAll(() => {
    a = new HTUAssistant();
    // use a tiny dataset assumption; tests will at minimum check normalize
  });

  test('normalize removes diacritics and punctuation', () => {
    const input = 'Àl-Hussein, Dr. Omar!';
    const out = a.normalize(input);
    expect(out).toContain('al');
    expect(out).toContain('hussein');
    expect(out).toContain('dr');
  });
});

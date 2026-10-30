import { describe, expect, it } from 'vitest';
import { PredefinedRepliesTransformer } from '../service/predefined-replies.transformer.js';

describe('PredefinedRepliesTransformer', () => {
  const transformer = new PredefinedRepliesTransformer();

  it('maps a stored row to the validated HTTP DTO', () => {
    expect(
      transformer.toResponse({
        id: 7,
        name: 'Greeting',
        message: '<p>Hello<br>there</p>',
      }),
    ).toEqual({
      id: '7',
      name: 'Greeting',
      message: 'Hello\nthere',
      hasOtherFormatting: false,
    });
  });

  it('flags legacy formatting and does not expose extra row fields', () => {
    const row = {
      id: 8,
      name: 'Legacy',
      message: '<p><span style="color:red">Hi</span></p>',
      extra: 'hidden',
    };

    expect(transformer.toResponse(row)).toEqual({
      id: '8',
      name: 'Legacy',
      message: 'Hi',
      hasOtherFormatting: true,
    });
  });
});

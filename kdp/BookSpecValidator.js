/**
 * kdp/BookSpecValidator.js
 * Comprehensive validation and normalization engine for KDP Book Specifications.
 * Rejects ambiguous, invalid, or out-of-range inputs with structured diagnostic errors.
 */

import { STANDARD_TRIM_SIZES, ORIENTATION, resolveDimensions } from './TrimSizes.js';

export const BLEED_MODE = {
  NO_BLEED: 'NO_BLEED',
  BLEED: 'BLEED'
};

export const COMPLEXITY_LEVEL = {
  VERY_SIMPLE: 'VERY_SIMPLE',
  SIMPLE: 'SIMPLE',
  MEDIUM: 'MEDIUM',
  DETAILED: 'DETAILED',
  ADVANCED: 'ADVANCED'
};

export const BACKGROUND_TYPE = {
  WHITE: 'WHITE',
  MINIMAL: 'MINIMAL',
  SCENE: 'SCENE',
  TRANSPARENT: 'TRANSPARENT'
};

export const COLOR_MODE = {
  BLACK_WHITE: 'BLACK_WHITE',
  GRAYSCALE: 'GRAYSCALE',
  COLOR: 'COLOR'
};

export const STANDARD_STYLES = [
  'CLEAN_LINE_ART',
  'BOLD_LINE_ART',
  'CARTOON_LINE_ART',
  'KIDS_COLORING',
  'EDUCATIONAL_LINE_ART'
];

export const TARGET_AGE_PRESETS = {
  '3-5': { category: '3-5', min_age: 3, max_age: 5, label: 'Toddlers & Preschool (Ages 3-5)' },
  '4-8': { category: '4-8', min_age: 4, max_age: 8, label: 'Early Readers (Ages 4-8)' },
  '6-10': { category: '6-10', min_age: 6, max_age: 10, label: 'Kids (Ages 6-10)' },
  '8-12': { category: '8-12', min_age: 8, max_age: 12, label: 'Tweens (Ages 8-12)' },
  'adult': { category: 'adult', min_age: 18, max_age: 99, label: 'Adults & Teens' }
};

export class BookSpecValidator {
  /**
   * Validates a book specification object.
   * @param {Object} spec
   * @returns {Object} { valid: boolean, errors: Array, warnings: Array }
   */
  static validate(spec) {
    const errors = [];
    const warnings = [];

    if (!spec || typeof spec !== 'object') {
      return {
        valid: false,
        errors: [{ field: 'root', code: 'INVALID_SPEC', message: 'Specification must be a non-null object.' }],
        warnings
      };
    }

    // 1. Title Validation
    if (!spec.book_title || typeof spec.book_title !== 'string' || spec.book_title.trim().length === 0) {
      errors.push({
        field: 'book_title',
        code: 'REQUIRED_FIELD',
        message: 'Book title is required and cannot be blank.'
      });
    } else if (spec.book_title.trim().length > 200) {
      errors.push({
        field: 'book_title',
        code: 'TITLE_TOO_LONG',
        message: 'Book title must not exceed 200 characters.'
      });
    }

    // 2. Page Count Validation (Strict: 1 to 500 content pages)
    const pc = spec.page_count;
    if (pc === null || pc === undefined || typeof pc !== 'number' || !Number.isInteger(pc) || !Number.isFinite(pc)) {
      errors.push({
        field: 'page_count',
        code: 'INVALID_PAGE_COUNT',
        message: 'Page count must be a valid integer.'
      });
    } else if (pc < 1 || pc > 500) {
      errors.push({
        field: 'page_count',
        code: 'PAGE_COUNT_OUT_OF_RANGE',
        message: `Page count must be between 1 and 500 (received ${pc}).`
      });
    }

    // 3. Trim Size & Dimensions
    if (!spec.trim_size) {
      errors.push({
        field: 'trim_size',
        code: 'REQUIRED_FIELD',
        message: 'Trim size configuration is required.'
      });
    } else {
      const sizeId = typeof spec.trim_size === 'string' ? spec.trim_size : spec.trim_size.id;
      const isKnown = STANDARD_TRIM_SIZES[sizeId] || sizeId === 'custom';
      if (!isKnown) {
        errors.push({
          field: 'trim_size',
          code: 'UNSUPPORTED_TRIM_SIZE',
          message: `Trim size "${sizeId}" is unsupported. Supported: 8.5x11, 8x10, 8.5x8.5, 8x8, custom.`
        });
      }

      if (typeof spec.trim_size === 'object') {
        const w = spec.trim_size.width_inches;
        const h = spec.trim_size.height_inches;
        if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
          errors.push({
            field: 'trim_size.dimensions',
            code: 'INVALID_DIMENSIONS',
            message: 'Trim size width and height in inches must be positive finite numbers.'
          });
        }
      }
    }

    // 4. Orientation
    const orient = spec.orientation;
    if (!orient || !Object.values(ORIENTATION).includes(orient)) {
      errors.push({
        field: 'orientation',
        code: 'INVALID_ORIENTATION',
        message: `Orientation must be one of: ${Object.values(ORIENTATION).join(', ')}.`
      });
    }

    // 5. Bleed
    const bleed = spec.bleed;
    if (!bleed || !Object.values(BLEED_MODE).includes(bleed)) {
      errors.push({
        field: 'bleed',
        code: 'INVALID_BLEED',
        message: `Bleed mode must be one of: ${Object.values(BLEED_MODE).join(', ')}.`
      });
    }

    // 6. Complexity
    const comp = spec.complexity;
    if (!comp || !Object.values(COMPLEXITY_LEVEL).includes(comp)) {
      errors.push({
        field: 'complexity',
        code: 'INVALID_COMPLEXITY',
        message: `Complexity must be one of: ${Object.values(COMPLEXITY_LEVEL).join(', ')}.`
      });
    }

    // 7. Background
    const bg = spec.background;
    if (!bg || !Object.values(BACKGROUND_TYPE).includes(bg)) {
      errors.push({
        field: 'background',
        code: 'INVALID_BACKGROUND',
        message: `Background must be one of: ${Object.values(BACKGROUND_TYPE).join(', ')}.`
      });
    }

    // 8. Color Mode
    const cm = spec.color_mode;
    if (!cm || !Object.values(COLOR_MODE).includes(cm)) {
      errors.push({
        field: 'color_mode',
        code: 'INVALID_COLOR_MODE',
        message: `Color mode must be one of: ${Object.values(COLOR_MODE).join(', ')}.`
      });
    }

    // 9. Target Age
    if (!spec.target_age) {
      errors.push({
        field: 'target_age',
        code: 'REQUIRED_FIELD',
        message: 'Target age is required.'
      });
    } else if (typeof spec.target_age === 'object') {
      if (typeof spec.target_age.min_age !== 'number' || typeof spec.target_age.max_age !== 'number') {
        errors.push({
          field: 'target_age',
          code: 'INVALID_AGE_RANGE',
          message: 'Structured target_age must contain numeric min_age and max_age.'
        });
      } else if (spec.target_age.min_age < 0 || spec.target_age.max_age < spec.target_age.min_age) {
        errors.push({
          field: 'target_age',
          code: 'INVALID_AGE_RANGE',
          message: 'min_age must be non-negative and max_age must be >= min_age.'
        });
      }
    }

    // 10. Margins
    if (spec.page_margin) {
      const { top_inches, bottom_inches, inside_inches, outside_inches } = spec.page_margin;
      const marginValues = [top_inches, bottom_inches, inside_inches, outside_inches];

      if (marginValues.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0.25)) {
        errors.push({
          field: 'page_margin',
          code: 'INVALID_MARGINS',
          message: 'All page margins (top, bottom, inside, outside) must be numbers >= 0.25 inches (KDP minimum).'
        });
      }
    } else {
      errors.push({
        field: 'page_margin',
        code: 'REQUIRED_FIELD',
        message: 'page_margin configuration is required.'
      });
    }

    // 11. Activity Pages
    if (spec.activity_pages) {
      if (typeof spec.activity_pages.enabled !== 'boolean') {
        errors.push({
          field: 'activity_pages.enabled',
          code: 'INVALID_BOOLEAN',
          message: 'activity_pages.enabled must be a boolean.'
        });
      }
      const acCount = spec.activity_pages.count;
      if (typeof acCount !== 'number' || !Number.isInteger(acCount) || acCount < 0 || acCount > 100) {
        errors.push({
          field: 'activity_pages.count',
          code: 'INVALID_ACTIVITY_COUNT',
          message: 'activity_pages.count must be an integer between 0 and 100.'
        });
      }
    }

    // 12. Front Matter Structure
    if (spec.front_matter) {
      const booleanKeys = ['title_page', 'copyright_page', 'introduction_page', 'instructions_page'];
      for (const k of booleanKeys) {
        if (spec.front_matter[k] !== undefined && typeof spec.front_matter[k] !== 'boolean') {
          errors.push({
            field: `front_matter.${k}`,
            code: 'INVALID_BOOLEAN',
            message: `front_matter.${k} must be a boolean.`
          });
        }
      }
    }

    // 13. Boolean flags validation
    if (typeof spec.blank_back_pages !== 'boolean') {
      errors.push({
        field: 'blank_back_pages',
        code: 'INVALID_BOOLEAN',
        message: 'blank_back_pages must be a boolean.'
      });
    }
    if (typeof spec.page_numbering !== 'boolean') {
      errors.push({
        field: 'page_numbering',
        code: 'INVALID_BOOLEAN',
        message: 'page_numbering must be a boolean.'
      });
    }

    // Warnings: High page count or small margins
    if (pc > 150) {
      warnings.push({
        field: 'page_count',
        code: 'HIGH_PAGE_COUNT',
        message: `High page count (${pc}). For KDP paperbacks, gutter margins must be increased for spine thickness.`
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
}

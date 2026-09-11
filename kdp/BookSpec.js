/**
 * kdp/BookSpec.js
 * Immutable, deterministic Book Specification model.
 * Single source of truth for all downstream production modules (prompts, layout, PPTX, QC).
 */

import { resolveDimensions, ORIENTATION } from './TrimSizes.js';
import {
  BookSpecValidator,
  BLEED_MODE,
  COMPLEXITY_LEVEL,
  BACKGROUND_TYPE,
  COLOR_MODE,
  TARGET_AGE_PRESETS
} from './BookSpecValidator.js';

export class BookSpec {
  /**
   * Constructs an immutable BookSpec.
   * Internal constructor; prefer BookSpec.create() for validation and normalization.
   */
  constructor(data) {
    this.project_id = data.project_id;
    this.book_title = data.book_title;
    this.subtitle = data.subtitle;
    this.language = data.language;
    this.target_age = data.target_age;
    this.theme = data.theme;
    this.page_count = data.page_count;
    this.trim_size = data.trim_size;
    this.orientation = data.orientation;
    this.bleed = data.bleed;
    this.complexity = data.complexity;
    this.style = data.style;
    this.background = data.background;
    this.blank_back_pages = data.blank_back_pages;
    this.front_matter = data.front_matter;
    this.page_numbering = data.page_numbering;
    this.activity_pages = data.activity_pages;
    this.line_art = data.line_art;
    this.color_mode = data.color_mode;
    this.page_margin = data.page_margin;
    this.safe_area = data.safe_area;
    this.notes = data.notes;

    Object.freeze(this.trim_size);
    Object.freeze(this.target_age);
    Object.freeze(this.front_matter);
    Object.freeze(this.activity_pages);
    Object.freeze(this.page_margin);
    Object.freeze(this.safe_area);
    Object.freeze(this);
  }

  /**
   * Deterministic factory method with normalization and strict validation.
   * @param {Object} rawInput
   * @returns {BookSpec}
   */
  static create(rawInput = {}) {
    const normalized = BookSpec.normalize(rawInput);
    const validation = BookSpecValidator.validate(normalized);

    if (!validation.valid) {
      const errorMsg = validation.errors.map(e => `[${e.field}] ${e.code}: ${e.message}`).join('; ');
      const err = new Error(`BookSpec validation failed: ${errorMsg}`);
      err.validation = validation;
      throw err;
    }

    return new BookSpec(normalized);
  }

  /**
   * Normalizes raw input deterministically without silent repair of dangerous values.
   */
  static normalize(input = {}) {
    const title = String(input.book_title || input.title || '').trim();
    const subtitle = String(input.subtitle || '').trim();
    const language = String(input.language || 'en').trim().toLowerCase();
    const theme = String(input.theme || '').trim();
    const notes = String(input.notes || '').trim();

    // Numeric page count conversion
    let pageCount = input.page_count !== undefined ? input.page_count : input.pages;
    if (typeof pageCount === 'string' && pageCount.trim() !== '') {
      pageCount = Number(pageCount.trim());
    }

    // Orientation
    const orient = String(input.orientation || ORIENTATION.PORTRAIT).trim().toUpperCase();

    // Resolve trim size dimensions
    const trimSizeInput = input.trim_size || input.size || '8.5x11';
    const trimId = typeof trimSizeInput === 'string' ? trimSizeInput : trimSizeInput.id;
    const customDims = input.custom_dimensions || (typeof trimSizeInput === 'object' ? trimSizeInput : null);
    const resolvedTrim = resolveDimensions(trimId, orient, customDims);

    // Target age normalization
    let targetAgeObj = null;
    const rawAge = input.target_age || input.age || '4-8';
    if (typeof rawAge === 'string') {
      const cleanAge = rawAge.trim().toLowerCase();
      targetAgeObj = TARGET_AGE_PRESETS[cleanAge] || {
        category: cleanAge,
        min_age: 4,
        max_age: 8,
        label: `Ages ${cleanAge}`
      };
    } else if (typeof rawAge === 'object' && rawAge !== null) {
      targetAgeObj = {
        category: String(rawAge.category || `${rawAge.min_age}-${rawAge.max_age}`),
        min_age: Number(rawAge.min_age),
        max_age: Number(rawAge.max_age),
        label: String(rawAge.label || `Ages ${rawAge.min_age}-${rawAge.max_age}`)
      };
    }

    // Bleed mode
    const bleed = String(input.bleed || BLEED_MODE.NO_BLEED).trim().toUpperCase();

    // Complexity
    const complexity = String(input.complexity || COMPLEXITY_LEVEL.SIMPLE).trim().toUpperCase();

    // Style
    const style = String(input.style || 'CLEAN_LINE_ART').trim().toUpperCase();

    // Background
    const background = String(input.background || BACKGROUND_TYPE.WHITE).trim().toUpperCase();

    // Color mode
    const colorMode = String(input.color_mode || COLOR_MODE.BLACK_WHITE).trim().toUpperCase();

    // Blank backs
    const blankBacks = input.blank_back_pages !== undefined ? Boolean(input.blank_back_pages) : true;

    // Page numbering
    const pageNumbering = input.page_numbering !== undefined ? Boolean(input.page_numbering) : false;

    // Front matter
    const fmInput = input.front_matter || {};
    const frontMatter = {
      title_page: fmInput.title_page !== undefined ? Boolean(fmInput.title_page) : true,
      copyright_page: fmInput.copyright_page !== undefined ? Boolean(fmInput.copyright_page) : true,
      introduction_page: fmInput.introduction_page !== undefined ? Boolean(fmInput.introduction_page) : true,
      instructions_page: fmInput.instructions_page !== undefined ? Boolean(fmInput.instructions_page) : false
    };

    // Activity pages
    const actInput = input.activity_pages || {};
    let actCount = actInput.count !== undefined ? actInput.count : 0;
    if (typeof actCount === 'string') actCount = Number(actCount);
    const activityPages = {
      enabled: actInput.enabled !== undefined ? Boolean(actInput.enabled) : false,
      count: actCount
    };

    // Margins (in inches)
    const marginInput = input.page_margin || {};
    const margins = {
      top_inches: Number(marginInput.top_inches ?? 0.375),
      bottom_inches: Number(marginInput.bottom_inches ?? 0.375),
      inside_inches: Number(marginInput.inside_inches ?? 0.5), // Gutter margin
      outside_inches: Number(marginInput.outside_inches ?? 0.375)
    };

    // Safe Area derived deterministically from trim dimensions and margins
    const safeWidth = Number((resolvedTrim.width_inches - margins.inside_inches - margins.outside_inches).toFixed(3));
    const safeHeight = Number((resolvedTrim.height_inches - margins.top_inches - margins.bottom_inches).toFixed(3));
    const safeArea = {
      width_inches: Math.max(0, safeWidth),
      height_inches: Math.max(0, safeHeight),
      margin_inches: margins
    };

    return {
      project_id: input.project_id ? String(input.project_id).trim() : 'kdp_project',
      book_title: title,
      subtitle,
      language,
      target_age: targetAgeObj,
      theme,
      page_count: pageCount,
      trim_size: resolvedTrim,
      orientation: resolvedTrim.orientation,
      bleed,
      complexity,
      style,
      background,
      blank_back_pages: blankBacks,
      front_matter: frontMatter,
      page_numbering: pageNumbering,
      activity_pages: activityPages,
      line_art: input.line_art !== undefined ? Boolean(input.line_art) : true,
      color_mode: colorMode,
      page_margin: margins,
      safe_area: safeArea,
      notes
    };
  }

  /**
   * Calculates total book interior page count (for future layout and spine thickness calculation).
   * Does not mutate content page_count.
   * @returns {Object} { frontMatterPages, contentPages, blankBackPages, activityPages, totalInteriorPages }
   */
  calculateInteriorPageCounts() {
    let frontMatterPages = 0;
    if (this.front_matter.title_page) frontMatterPages++;
    if (this.front_matter.copyright_page) frontMatterPages++;
    if (this.front_matter.introduction_page) frontMatterPages++;
    if (this.front_matter.instructions_page) frontMatterPages++;

    const contentPages = this.page_count;
    const contentBlanks = this.blank_back_pages ? contentPages : 0;

    let activityPages = 0;
    let activityBlanks = 0;
    if (this.activity_pages.enabled && this.activity_pages.count > 0) {
      activityPages = this.activity_pages.count;
      if (this.blank_back_pages) activityBlanks = activityPages;
    }

    const totalInteriorPages =
      frontMatterPages +
      contentPages +
      contentBlanks +
      activityPages +
      activityBlanks;

    return {
      frontMatterPages,
      contentPages,
      contentBlanks,
      activityPages,
      activityBlanks,
      totalInteriorPages
    };
  }

  /**
   * Saves BookSpec to canonical /state/BOOK_SPEC.json
   */
  saveToState(githubManager) {
    return githubManager.writeProjectFile('state/BOOK_SPEC.json', this.toJSON());
  }

  /**
   * Recovers BookSpec from canonical /state/BOOK_SPEC.json
   */
  static loadFromState(githubManager) {
    const raw = githubManager.readLocalFile('state/BOOK_SPEC.json');
    if (!raw) return null;
    return BookSpec.create(JSON.parse(raw));
  }

  toJSON() {
    return {
      project_id: this.project_id,
      book_title: this.book_title,
      subtitle: this.subtitle,
      language: this.language,
      target_age: this.target_age,
      theme: this.theme,
      page_count: this.page_count,
      trim_size: this.trim_size,
      orientation: this.orientation,
      bleed: this.bleed,
      complexity: this.complexity,
      style: this.style,
      background: this.background,
      blank_back_pages: this.blank_back_pages,
      front_matter: this.front_matter,
      page_numbering: this.page_numbering,
      activity_pages: this.activity_pages,
      line_art: this.line_art,
      color_mode: this.color_mode,
      page_margin: this.page_margin,
      safe_area: this.safe_area,
      notes: this.notes
    };
  }
}

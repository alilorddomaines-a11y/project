/**
 * tests/book_spec_tests.js
 * Automated test suite for Phase 2A: KDP Book Specification Engine.
 * Tests all 16 required specification scenarios in an isolated sandbox.
 */

import { BookSpec } from '../kdp/BookSpec.js';
import { BookSpecValidator } from '../kdp/BookSpecValidator.js';
import { ORIENTATION } from '../kdp/TrimSizes.js';

const results = {};
console.log('===============================================================');
console.log('      PHASE 2A: KDP BOOK SPECIFICATION ENGINE — TEST SUITE     ');
console.log('===============================================================\n');

// 1. Valid 8.5x11 portrait book
try {
  const spec = BookSpec.create({
    title: 'Forest Animals',
    pages: 40,
    size: '8.5x11',
    orientation: 'PORTRAIT'
  });
  if (
    spec.trim_size.width_inches === 8.5 &&
    spec.trim_size.height_inches === 11.0 &&
    spec.orientation === 'PORTRAIT' &&
    spec.trim_size.aspect_ratio === 0.7727
  ) {
    results['1. Valid 8.5x11 portrait book'] = 'PASS';
  } else {
    results['1. Valid 8.5x11 portrait book'] = 'FAIL';
  }
} catch (e) {
  results['1. Valid 8.5x11 portrait book'] = `FAIL (${e.message})`;
}

// 2. Valid 8.5x11 landscape book
try {
  const spec = BookSpec.create({
    title: 'Forest Animals Landscape',
    pages: 30,
    size: '8.5x11',
    orientation: 'LANDSCAPE'
  });
  if (
    spec.trim_size.width_inches === 11.0 &&
    spec.trim_size.height_inches === 8.5 &&
    spec.orientation === 'LANDSCAPE' &&
    spec.trim_size.aspect_ratio === 1.2941
  ) {
    results['2. Valid 8.5x11 landscape book'] = 'PASS';
  } else {
    results['2. Valid 8.5x11 landscape book'] = 'FAIL';
  }
} catch (e) {
  results['2. Valid 8.5x11 landscape book'] = `FAIL (${e.message})`;
}

// 3. Valid 8x8 square book
try {
  const spec = BookSpec.create({
    title: 'Forest Animals Square',
    pages: 24,
    size: '8x8',
    orientation: 'PORTRAIT' // Should enforce SQUARE
  });
  if (
    spec.trim_size.width_inches === 8.0 &&
    spec.trim_size.height_inches === 8.0 &&
    spec.orientation === 'SQUARE' &&
    spec.trim_size.is_square === true
  ) {
    results['3. Valid 8x8 square book'] = 'PASS';
  } else {
    results['3. Valid 8x8 square book'] = 'FAIL';
  }
} catch (e) {
  results['3. Valid 8x8 square book'] = `FAIL (${e.message})`;
}

// 4. Custom trim size
try {
  const spec = BookSpec.create({
    title: 'Custom Coloring Book',
    pages: 25,
    size: 'custom',
    custom_dimensions: { widthInches: 7.0, heightInches: 9.0 }
  });
  if (
    spec.trim_size.is_custom === true &&
    spec.trim_size.width_inches === 7.0 &&
    spec.trim_size.height_inches === 9.0 &&
    spec.trim_size.aspect_ratio === 0.7778
  ) {
    results['4. Custom trim size'] = 'PASS';
  } else {
    results['4. Custom trim size'] = 'FAIL';
  }
} catch (e) {
  results['4. Custom trim size'] = `FAIL (${e.message})`;
}

// 5. Invalid page count (0, negative, non-integer, > 500)
try {
  const cases = [0, -5, 3.14, NaN, Infinity, 501];
  let allCaught = true;
  for (const invalidPage of cases) {
    try {
      BookSpec.create({ title: 'Invalid Pages', pages: invalidPage });
      allCaught = false;
      break;
    } catch (e) {
      // Expected rejection
    }
  }
  results['5. Invalid page count'] = allCaught ? 'PASS' : 'FAIL';
} catch (e) {
  results['5. Invalid page count'] = `FAIL (${e.message})`;
}

// 6. Invalid orientation
try {
  try {
    BookSpec.create({ title: 'Invalid Orient', pages: 20, orientation: 'DIAGONAL' });
    results['6. Invalid orientation'] = 'FAIL';
  } catch (e) {
    results['6. Invalid orientation'] = 'PASS';
  }
} catch (e) {
  results['6. Invalid orientation'] = `FAIL (${e.message})`;
}

// 7. Invalid bleed
try {
  try {
    BookSpec.create({ title: 'Invalid Bleed', pages: 20, bleed: 'SUPER_BLEED' });
    results['7. Invalid bleed'] = 'FAIL';
  } catch (e) {
    results['7. Invalid bleed'] = 'PASS';
  }
} catch (e) {
  results['7. Invalid bleed'] = `FAIL (${e.message})`;
}

// 8. Invalid complexity
try {
  try {
    BookSpec.create({ title: 'Invalid Complexity', pages: 20, complexity: 'IMPOSSIBLE' });
    results['8. Invalid complexity'] = 'FAIL';
  } catch (e) {
    results['8. Invalid complexity'] = 'PASS';
  }
} catch (e) {
  results['8. Invalid complexity'] = `FAIL (${e.message})`;
}

// 9. Invalid numeric margin (< 0.25 in)
try {
  try {
    BookSpec.create({
      title: 'Invalid Margin',
      pages: 20,
      page_margin: { top_inches: 0.1, bottom_inches: 0.375, inside_inches: 0.5, outside_inches: 0.375 }
    });
    results['9. Invalid numeric margin'] = 'FAIL';
  } catch (e) {
    results['9. Invalid numeric margin'] = 'PASS';
  }
} catch (e) {
  results['9. Invalid numeric margin'] = `FAIL (${e.message})`;
}

// 10. Invalid activity count (< 0 or > 100)
try {
  try {
    BookSpec.create({
      title: 'Invalid Activity',
      pages: 20,
      activity_pages: { enabled: true, count: 101 }
    });
    results['10. Invalid activity count'] = 'FAIL';
  } catch (e) {
    results['10. Invalid activity count'] = 'PASS';
  }
} catch (e) {
  results['10. Invalid activity count'] = `FAIL (${e.message})`;
}

// 11. Front matter configuration
try {
  const spec = BookSpec.create({
    title: 'Front Matter Test',
    pages: 20,
    front_matter: {
      title_page: true,
      copyright_page: true,
      introduction_page: false,
      instructions_page: true
    }
  });
  if (
    spec.front_matter.title_page === true &&
    spec.front_matter.copyright_page === true &&
    spec.front_matter.introduction_page === false &&
    spec.front_matter.instructions_page === true
  ) {
    results['11. Front matter configuration'] = 'PASS';
  } else {
    results['11. Front matter configuration'] = 'FAIL';
  }
} catch (e) {
  results['11. Front matter configuration'] = `FAIL (${e.message})`;
}

// 12. Blank back pages
try {
  const specWithBlanks = BookSpec.create({ title: 'Blanks Test', pages: 10, blank_back_pages: true });
  const specNoBlanks = BookSpec.create({ title: 'No Blanks Test', pages: 10, blank_back_pages: false });

  const countsWith = specWithBlanks.calculateInteriorPageCounts();
  const countsNo = specNoBlanks.calculateInteriorPageCounts();

  if (
    countsWith.contentPages === 10 &&
    countsWith.contentBlanks === 10 &&
    countsNo.contentPages === 10 &&
    countsNo.contentBlanks === 0
  ) {
    results['12. Blank back pages'] = 'PASS';
  } else {
    results['12. Blank back pages'] = 'FAIL';
  }
} catch (e) {
  results['12. Blank back pages'] = `FAIL (${e.message})`;
}

// 13. Page numbering
try {
  const specNumbered = BookSpec.create({ title: 'Numbered', pages: 10, page_numbering: true });
  const specUnnumbered = BookSpec.create({ title: 'Unnumbered', pages: 10, page_numbering: false });

  if (specNumbered.page_numbering === true && specUnnumbered.page_numbering === false) {
    results['13. Page numbering'] = 'PASS';
  } else {
    results['13. Page numbering'] = 'FAIL';
  }
} catch (e) {
  results['13. Page numbering'] = `FAIL (${e.message})`;
}

// 14. Deterministic normalization
try {
  const normalized = BookSpec.normalize({
    title: '  Dinosaur Adventure  ',
    pages: ' 45 ',
    size: '8.5x11',
    complexity: 'medium',
    bleed: 'no_bleed',
    language: 'EN '
  });

  if (
    normalized.book_title === 'Dinosaur Adventure' &&
    normalized.page_count === 45 &&
    normalized.complexity === 'MEDIUM' &&
    normalized.bleed === 'NO_BLEED' &&
    normalized.language === 'en' &&
    normalized.safe_area.width_inches === 7.625 &&
    normalized.safe_area.height_inches === 10.25
  ) {
    results['14. Deterministic normalization'] = 'PASS';
  } else {
    results['14. Deterministic normalization'] = 'FAIL';
  }
} catch (e) {
  results['14. Deterministic normalization'] = `FAIL (${e.message})`;
}

// 15. Same input produces identical BookSpec
try {
  const input = {
    title: 'Magical Unicorns',
    pages: 50,
    size: '8.5x11',
    orientation: 'PORTRAIT',
    target_age: '4-8',
    complexity: 'SIMPLE',
    bleed: 'NO_BLEED'
  };

  const spec1 = BookSpec.create(input);
  const spec2 = BookSpec.create(input);

  const json1 = JSON.stringify(spec1);
  const json2 = JSON.stringify(spec2);

  if (json1 === json2) {
    results['15. Same input produces identical BookSpec'] = 'PASS';
  } else {
    results['15. Same input produces identical BookSpec'] = 'FAIL (Non-deterministic output)';
  }
} catch (e) {
  results['15. Same input produces identical BookSpec'] = `FAIL (${e.message})`;
}

// 16. Extension-compatible spec creation
try {
  const uiFormData = {
    title: 'Cute Forest Animals Coloring Book',
    subtitle: '40 Relaxing Animal Illustrations for Kids',
    language: 'en',
    targetAge: '4-8',
    pages: 10,
    trimSize: '8.5x11',
    orientation: 'PORTRAIT',
    bleed: 'NO_BLEED',
    complexity: 'SIMPLE',
    style: 'CLEAN_LINE_ART',
    background: 'WHITE',
    blankBacks: true,
    pageNumbers: false,
    frontMatter: {
      title_page: true,
      copyright_page: true,
      introduction_page: true,
      instructions_page: false
    },
    activityPages: {
      enabled: false,
      count: 0
    }
  };

  const spec = BookSpec.create({
    book_title: uiFormData.title,
    subtitle: uiFormData.subtitle,
    language: uiFormData.language,
    target_age: uiFormData.targetAge,
    page_count: uiFormData.pages,
    trim_size: uiFormData.trimSize,
    orientation: uiFormData.orientation,
    bleed: uiFormData.bleed,
    complexity: uiFormData.complexity,
    style: uiFormData.style,
    background: uiFormData.background,
    blank_back_pages: uiFormData.blankBacks,
    page_numbering: uiFormData.pageNumbers,
    front_matter: uiFormData.frontMatter,
    activity_pages: uiFormData.activityPages
  });

  if (spec && spec.book_title === uiFormData.title && spec.page_count === 10) {
    results['16. Extension-compatible spec creation'] = 'PASS';
  } else {
    results['16. Extension-compatible spec creation'] = 'FAIL';
  }
} catch (e) {
  results['16. Extension-compatible spec creation'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// REPORT SUMMARY
// -----------------------------------------------------------------------------
let allPassed = true;
for (const [testName, status] of Object.entries(results)) {
  const isPass = status === 'PASS';
  if (!isPass) allPassed = false;
  console.log(`${testName.padEnd(58)} : [ ${isPass ? 'PASS ✅' : status} ]`);
}

console.log('\n===============================================================');
if (allPassed) {
  console.log('🎯 ALL PHASE 2A BOOK SPEC TESTS PASSED SUCCESSFULLY (16/16).');
  process.exit(0);
} else {
  console.error('❌ SOME PHASE 2A BOOK SPEC TESTS FAILED.');
  process.exit(1);
}

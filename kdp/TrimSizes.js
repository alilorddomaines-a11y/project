/**
 * kdp/TrimSizes.js
 * Centralized trim-size registry and orientation resolver for Amazon KDP books.
 * Preserves exact numerical dimensions and aspect ratios without distortion.
 */

export const ORIENTATION = {
  PORTRAIT: 'PORTRAIT',
  LANDSCAPE: 'LANDSCAPE',
  SQUARE: 'SQUARE'
};

export const STANDARD_TRIM_SIZES = {
  '8.5x11': {
    id: '8.5x11',
    label: '8.5 x 11 in',
    nominalWidth: 8.5,
    nominalHeight: 11.0,
    isSquare: false
  },
  '8x10': {
    id: '8x10',
    label: '8 x 10 in',
    nominalWidth: 8.0,
    nominalHeight: 10.0,
    isSquare: false
  },
  '8.5x8.5': {
    id: '8.5x8.5',
    label: '8.5 x 8.5 in',
    nominalWidth: 8.5,
    nominalHeight: 8.5,
    isSquare: true
  },
  '8x8': {
    id: '8x8',
    label: '8 x 8 in',
    nominalWidth: 8.0,
    nominalHeight: 8.0,
    isSquare: true
  }
};

/**
 * Resolves explicit numeric dimensions based on trim size and orientation.
 * @param {string} sizeId
 * @param {string} requestedOrientation
 * @param {Object|null} customDimensions - { widthInches, heightInches }
 * @returns {Object}
 */
export function resolveDimensions(sizeId, requestedOrientation = ORIENTATION.PORTRAIT, customDimensions = null) {
  const normId = String(sizeId || '').trim().toLowerCase();
  const normOrient = String(requestedOrientation || ORIENTATION.PORTRAIT).trim().toUpperCase();

  if (!Object.values(ORIENTATION).includes(normOrient)) {
    throw new Error(`Invalid orientation: "${requestedOrientation}". Supported: PORTRAIT, LANDSCAPE, SQUARE.`);
  }

  if (normId === 'custom') {
    if (!customDimensions) {
      throw new Error('Custom trim size requires numeric widthInches and heightInches.');
    }
    const width = Number(customDimensions.widthInches);
    const height = Number(customDimensions.heightInches);

    if (!Number.isFinite(width) || width <= 0) {
      throw new Error(`Invalid custom width: ${customDimensions.widthInches}`);
    }
    if (!Number.isFinite(height) || height <= 0) {
      throw new Error(`Invalid custom height: ${customDimensions.heightInches}`);
    }

    let finalW = width;
    let finalH = height;
    let finalOrient = normOrient;

    if (Math.abs(width - height) < 0.001) {
      finalOrient = ORIENTATION.SQUARE;
    } else if (normOrient === ORIENTATION.LANDSCAPE) {
      finalW = Math.max(width, height);
      finalH = Math.min(width, height);
    } else if (normOrient === ORIENTATION.PORTRAIT) {
      finalW = Math.min(width, height);
      finalH = Math.max(width, height);
    }

    return {
      id: 'custom',
      label: `Custom (${finalW} x ${finalH} in)`,
      width_inches: Number(finalW.toFixed(3)),
      height_inches: Number(finalH.toFixed(3)),
      orientation: finalOrient,
      aspect_ratio: Number((finalW / finalH).toFixed(4)),
      is_square: finalOrient === ORIENTATION.SQUARE,
      is_custom: true
    };
  }

  const standard = STANDARD_TRIM_SIZES[normId];
  if (!standard) {
    throw new Error(`Unsupported trim size identifier: "${sizeId}".`);
  }

  if (standard.isSquare) {
    return {
      id: standard.id,
      label: standard.label,
      width_inches: standard.nominalWidth,
      height_inches: standard.nominalHeight,
      orientation: ORIENTATION.SQUARE,
      aspect_ratio: 1.0,
      is_square: true,
      is_custom: false
    };
  }

  // Rectangular standard size: apply requested orientation
  let finalWidth, finalHeight, finalOrientation;

  if (normOrient === ORIENTATION.LANDSCAPE) {
    finalWidth = Math.max(standard.nominalWidth, standard.nominalHeight);
    finalHeight = Math.min(standard.nominalWidth, standard.nominalHeight);
    finalOrientation = ORIENTATION.LANDSCAPE;
  } else {
    // Default to PORTRAIT
    finalWidth = Math.min(standard.nominalWidth, standard.nominalHeight);
    finalHeight = Math.max(standard.nominalWidth, standard.nominalHeight);
    finalOrientation = ORIENTATION.PORTRAIT;
  }

  return {
    id: standard.id,
    label: standard.label,
    width_inches: Number(finalWidth.toFixed(3)),
    height_inches: Number(finalHeight.toFixed(3)),
    orientation: finalOrientation,
    aspect_ratio: Number((finalWidth / finalHeight).toFixed(4)),
    is_square: false,
    is_custom: false
  };
}

export function getAllStandardTrimSizes() {
  return Object.values(STANDARD_TRIM_SIZES);
}

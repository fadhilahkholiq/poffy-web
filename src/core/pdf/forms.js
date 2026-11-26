import {
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField
} from 'pdf-lib';
import { loadPdfSafe } from './doc-loader.js';

/**
 * @typedef {Object} InspectedFormField
 * @property {string} name - Fully qualified AcroForm field name
 * @property {'text'|'checkbox'|'dropdown'|'radio'|'optionlist'|'unknown'} type
 * @property {string|boolean|string[]} value - Current value
 * @property {string[]} options - Available choices for dropdown/radio/optionlist
 * @property {boolean} readOnly
 */

/**
 * @typedef {Object} FormApplyConfig
 * @property {Record<string, string|boolean|string[]>} [values={}] - Field name -> updated value
 * @property {boolean} [flatten=false] - Flatten AcroForm into static page content
 */

/**
 * Inspects all AcroForm fields in a PDF buffer.
 * @param {ArrayBuffer|Uint8Array} pdfBytes - Raw PDF bytes
 * @param {string} [fileName=''] - Optional filename for error context
 * @returns {Promise<InspectedFormField[]>}
 */
export async function inspectAcroFormFields(pdfBytes, fileName = '') {
  const doc = await loadPdfSafe(pdfBytes, fileName);
  const form = doc.getForm();
  const fields = form.getFields();

  return fields.map((field) => {
    const name = field.getName();
    const readOnly = field.isReadOnly();

    if (field instanceof PDFTextField) {
      return {
        name,
        type: 'text',
        value: field.getText() ?? '',
        options: [],
        readOnly
      };
    }
    if (field instanceof PDFCheckBox) {
      return {
        name,
        type: 'checkbox',
        value: field.isChecked(),
        options: [],
        readOnly
      };
    }
    if (field instanceof PDFDropdown) {
      return {
        name,
        type: 'dropdown',
        value: field.getSelected()[0] ?? '',
        options: field.getOptions(),
        readOnly
      };
    }
    if (field instanceof PDFRadioGroup) {
      return {
        name,
        type: 'radio',
        value: field.getSelected() ?? '',
        options: field.getOptions(),
        readOnly
      };
    }
    if (field instanceof PDFOptionList) {
      return {
        name,
        type: 'optionlist',
        value: field.getSelected(),
        options: field.getOptions(),
        readOnly
      };
    }

    return {
      name,
      type: 'unknown',
      value: '',
      options: [],
      readOnly
    };
  });
}

/**
 * Applies edited form field values and optionally flattens the AcroForm on a PDFDocument.
 * @param {import('pdf-lib').PDFDocument} pdfDoc - Target document
 * @param {FormApplyConfig} config - Values & flatten flag
 * @returns {import('pdf-lib').PDFDocument}
 */
export function applyFormChangesToDocument(pdfDoc, config) {
  if (!config) return pdfDoc;
  const form = pdfDoc.getForm();
  const fields = form.getFields();
  if (fields.length === 0) return pdfDoc;

  const values = config.values || {};
  for (const field of fields) {
    const name = field.getName();
    if (!(name in values)) continue;
    const nextVal = values[name];

    if (field instanceof PDFTextField) {
      field.setText(nextVal == null ? '' : String(nextVal));
    } else if (field instanceof PDFCheckBox) {
      if (nextVal) field.check();
      else field.uncheck();
    } else if (field instanceof PDFDropdown) {
      if (typeof nextVal === 'string' && nextVal) {
        field.select(nextVal);
      } else if (Array.isArray(nextVal) && nextVal.length > 0) {
        field.select(nextVal[0]);
      } else {
        field.clear();
      }
    } else if (field instanceof PDFRadioGroup) {
      if (typeof nextVal === 'string' && nextVal) {
        field.select(nextVal);
      } else {
        field.clear();
      }
    } else if (field instanceof PDFOptionList) {
      if (Array.isArray(nextVal)) {
        field.select(nextVal);
      } else if (typeof nextVal === 'string' && nextVal) {
        field.select(nextVal);
      } else {
        field.clear();
      }
    }
  }

  if (config.flatten) {
    form.flatten();
  }

  return pdfDoc;
}

/**
 * Standalone helper to edit form fields and/or flatten a PDF buffer.
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {FormApplyConfig} config
 * @param {string} [fileName='']
 * @returns {Promise<Uint8Array>}
 */
export async function fillAndFlattenPdf(pdfBytes, config, fileName = '') {
  const doc = await loadPdfSafe(pdfBytes, fileName);
  applyFormChangesToDocument(doc, config);
  return doc.save({ useObjectStreams: true });
}

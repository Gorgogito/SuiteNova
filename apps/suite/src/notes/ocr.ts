// El OCR de Notes es el compartido (`../ocr`); aquí solo quedan los nombres que Notes ya usaba.
export { readImage, readText as recognizeImage } from '../ocr/read';
export { disposeTesseract as disposeOcr } from '../ocr/tesseract';

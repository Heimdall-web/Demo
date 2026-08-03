const params = new URLSearchParams(window.location.search);
const target = params.get('target') || '';
const source = params.get('source') || '';
const resultValue = document.getElementById('resultValue');
const statusNode = document.getElementById('status');
const errorNode = document.getElementById('error');
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let stream = null;
let detector = null;
let detectionHandle = null;
let isScanning = false;

function setStatus(message, isError = false) {
  if (!statusNode) return;
  statusNode.textContent = message;
  statusNode.style.color = isError ? '#fca5a5' : '#dbeafe';
}

function setError(message) {
  if (!errorNode) return;
  errorNode.textContent = message || '';
  errorNode.style.display = message ? 'block' : 'none';
}

function stopStream() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  if (video) {
    video.srcObject = null;
  }
}

function emitResult(code) {
  const cleanCode = String(code || '').trim();
  if (!cleanCode) return;

  if (resultValue) {
    resultValue.value = cleanCode;
  }

  const payload = {
    type: 'heimdall-barcode',
    code: cleanCode,
    target,
    source
  };

  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage(payload, '*');
    } catch (e) {
      console.warn('No se pudo enviar el valor al opener', e);
    }
  }

  setStatus('Código detectado: ' + cleanCode);

  if (window.opener && !window.opener.closed) {
    window.setTimeout(() => {
      try {
        window.close();
      } catch (e) {
        console.warn('No se pudo cerrar la ventana del escáner:', e);
      }
    }, 350);
  }
}

function drawFrame() {
  if (!video || !canvas || !ctx) return;
  if (video.readyState >= 2) {
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }
}

async function initializeDetector() {
  if (!('BarcodeDetector' in window)) {
    return null;
  }

  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    const formats = supported.filter((format) =>
      ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'codabar', 'data_matrix'].includes(format)
    );
    return new BarcodeDetector({ formats: formats.length ? formats : ['qr_code', 'ean_13', 'code_128'] });
  } catch (e) {
    console.warn('BarcodeDetector no disponible:', e);
    return null;
  }
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setError('Este navegador no soporta acceso a cámara.');
    setStatus('La cámara no está disponible.', true);
    return;
  }

  if (!window.isSecureContext) {
    setError('La cámara requiere HTTPS o localhost. Sirve esta página con HTTPS.');
    setStatus('Contexto inseguro', true);
    return;
  }

  try {
    setStatus('Solicitando acceso a la cámara...');
    setError('');

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    if (video) {
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      video.play();
    }

    detector = await initializeDetector();
    isScanning = true;
    setStatus('Escaneando...');
    scanLoop();
  } catch (error) {
    console.error('Error al abrir cámara:', error);
    setError('No se pudo acceder a la cámara. Revisa el permiso del navegador.');
    setStatus('Acceso a cámara denegado', true);
  }
}

async function scanLoop() {
  if (!isScanning) return;

  try {
    drawFrame();

    if (detector && video && video.readyState >= 2) {
      const results = await detector.detect(video);
      if (results && results.length) {
        const value = results[0].rawValue || results[0].rawValue;
        if (value) {
          emitResult(value);
          return;
        }
      }
    }

    if (window.jsQR && video && video.readyState >= 2) {
      drawFrame();
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = window.jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth'
      });

      if (decoded && decoded.data) {
        emitResult(decoded.data);
        return;
      }
    }
  } catch (e) {
    console.warn('Detectando código:', e);
  }

  detectionHandle = window.setTimeout(scanLoop, 200);
}

function onManualSubmit() {
  const manualInput = document.getElementById('manualInput');
  const value = (manualInput?.value || '').trim();
  if (!value) {
    setError('Escribe un código o QR antes de continuar.');
    return;
  }
  emitResult(value);
}

function loadFallbackLibrary() {
  const existing = document.querySelector('script[data-jsqr]');
  if (existing) return;

  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
  script.async = true;
  script.dataset.jsqr = 'true';
  script.onload = () => {
    setStatus('Escaneando...');
  };
  script.onerror = () => {
    setError('No se pudo cargar el lector opcional de QR.');
  };
  document.head.appendChild(script);
}

document.getElementById('scanButton')?.addEventListener('click', () => {
  loadFallbackLibrary();
  startCamera();
});

document.getElementById('manualSubmit')?.addEventListener('click', onManualSubmit);

document.getElementById('closeButton')?.addEventListener('click', () => {
  isScanning = false;
  if (detectionHandle) {
    clearTimeout(detectionHandle);
    detectionHandle = null;
  }
  stopStream();
  if (window.opener && !window.opener.closed) {
    window.close();
  }
});

window.addEventListener('beforeunload', () => {
  isScanning = false;
  if (detectionHandle) {
    clearTimeout(detectionHandle);
    detectionHandle = null;
  }
  stopStream();
});

window.addEventListener('DOMContentLoaded', () => {
  setStatus('Listo para escanear');
  setError('');
  loadFallbackLibrary();
  startCamera();
});

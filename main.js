import './style.css';

import { AutoModel, AutoProcessor, env, RawImage } from '@xenova/transformers';

// Since we will download the model from the Hugging Face Hub, we can skip the local model check
env.allowLocalModels = false;

// Proxy the WASM backend to prevent the UI from freezing
env.backends.onnx.wasm.proxy = true;

// Constants
const EXAMPLE_URL = 'https://images.pexels.com/photos/5965592/pexels-photo-5965592.jpeg?auto=compress&cs=tinysrgb&w=1024';

// Reference the elements that we will need
const status = document.getElementById('status');
const queueInfo = document.getElementById('queue-info');
const fileUpload = document.getElementById('upload');
const originalImagesContainer = document.getElementById('original-images');
const processedImagesContainer = document.getElementById('processed-images');
const example = document.getElementById('example');
const startProcessingBtn = document.getElementById('start-processing');
const clearQueueBtn = document.getElementById('clear-queue');
const downloadAllBtn = document.getElementById('download-all');
const useCustomSizeCheckbox = document.getElementById('use-custom-size');
const sizeControls = document.getElementById('size-controls');
const exportWidthInput = document.getElementById('export-width');
const exportHeightInput = document.getElementById('export-height');
const lockAspectRatioCheckbox = document.getElementById('lock-aspect-ratio');

// Queue management
let imageQueue = [];
let processedImages = [];
let isProcessing = false;
let currentProcessingIndex = 0;

// Load model and processor
status.textContent = 'กำลังโหลดโมเดล...';

const model = await AutoModel.from_pretrained('briaai/RMBG-1.4', {
    // Do not require config.json to be present in the repository
    config: { model_type: 'custom' },
});

const processor = await AutoProcessor.from_pretrained('briaai/RMBG-1.4', {
    // Do not require config.json to be present in the repository
    config: {
        do_normalize: true,
        do_pad: false,
        do_rescale: true,
        do_resize: true,
        image_mean: [0.5, 0.5, 0.5],
        feature_extractor_type: "ImageFeatureExtractor",
        image_std: [1, 1, 1],
        resample: 2,
        rescale_factor: 0.00392156862745098,
        size: { width: 1024, height: 1024 },
    }
});

status.textContent = 'พร้อมใช้งาน';
updateQueueInfo();

// Initialize upload section visibility
const uploadSection = document.getElementById('upload-section');
uploadSection.style.display = 'block';

// Event listeners with safety checks
if (example) {
    example.addEventListener('click', (e) => {
        e.preventDefault();
        addToQueue({ url: EXAMPLE_URL, name: 'Example Image', type: 'example' });
    });
}

if (fileUpload) {
    fileUpload.addEventListener('change', function (e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) {
            return;
        }

        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = e2 => {
                addToQueue({
                    url: e2.target.result,
                    name: file.name,
                    type: 'file',
                    size: file.size
                });
            };
            reader.readAsDataURL(file);
        });

        // Clear the input
        e.target.value = '';
    });
}

// Drag and drop functionality
const uploadButton = document.getElementById('upload-button');

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function highlight(e) {
    uploadSection.classList.add('drag-over');
}

function unhighlight(e) {
    uploadSection.classList.remove('drag-over');
}

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = Array.from(dt.files);

    // Filter for image files only
    const imageFiles = files.filter(file => file.type.startsWith('image/'));

    if (imageFiles.length === 0) {
        alert('กรุณาลากเฉพาะไฟล์รูปภาพเท่านั้น');
        return;
    }

    imageFiles.forEach(file => {
        const reader = new FileReader();
        reader.onload = e2 => {
            addToQueue({
                url: e2.target.result,
                name: file.name,
                type: 'file',
                size: file.size
            });
        };
        reader.readAsDataURL(file);
    });
}

// Set up drag and drop event listeners after functions are defined with safety checks
if (uploadSection) {
    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadSection.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    // Highlight drop area when item is dragged over it
    ['dragenter', 'dragover'].forEach(eventName => {
        uploadSection.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        uploadSection.addEventListener(eventName, unhighlight, false);
    });

    // Handle dropped files
    uploadSection.addEventListener('drop', handleDrop, false);
}

// Clipboard paste functionality
function handlePaste(e) {
    const items = e.clipboardData.items;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (item.type.indexOf('image') !== -1) {
            const blob = item.getAsFile();
            const reader = new FileReader();

            reader.onload = (e2) => {
                addToQueue({
                    url: e2.target.result,
                    name: `รูปภาพจากคลิปบอร์ด ${Date.now()}.png`,
                    type: 'paste',
                    size: blob.size
                });
            };

            reader.readAsDataURL(blob);
            break;
        }
    }
}

document.addEventListener('paste', handlePaste, false);

// Add safety checks for event listeners
if (startProcessingBtn) {
    startProcessingBtn.addEventListener('click', () => {
        if (!isProcessing && imageQueue.length > 0) {
            processQueue();
        }
    });
}

if (clearQueueBtn) {
    clearQueueBtn.addEventListener('click', () => {
        if (!isProcessing) {
            clearQueue();
        }
    });
}

if (downloadAllBtn) {
    downloadAllBtn.addEventListener('click', () => {
        downloadAllProcessed();
    });
}

// Resize settings event listeners
if (useCustomSizeCheckbox) {
    useCustomSizeCheckbox.addEventListener('change', () => {
        if (sizeControls) {
            sizeControls.style.display = useCustomSizeCheckbox.checked ? 'block' : 'none';
        }
    });
}

// Aspect ratio locking
let originalAspectRatio = 1;

if (exportWidthInput) {
    exportWidthInput.addEventListener('input', () => {
        if (lockAspectRatioCheckbox && lockAspectRatioCheckbox.checked && exportHeightInput) {
            const newHeight = Math.round(exportWidthInput.value / originalAspectRatio);
            exportHeightInput.value = newHeight;
        }
    });
}

if (exportHeightInput) {
    exportHeightInput.addEventListener('input', () => {
        if (lockAspectRatioCheckbox && lockAspectRatioCheckbox.checked && exportWidthInput) {
            const newWidth = Math.round(exportHeightInput.value * originalAspectRatio);
            exportWidthInput.value = newWidth;
        }
    });
}

if (lockAspectRatioCheckbox) {
    lockAspectRatioCheckbox.addEventListener('change', () => {
        if (lockAspectRatioCheckbox.checked && exportWidthInput && exportHeightInput) {
            originalAspectRatio = exportWidthInput.value / exportHeightInput.value;
        }
    });
}

// Queue management functions
function addToQueue(imageData) {
    const queueItem = {
        id: `img_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        ...imageData,
        status: 'pending',
        addedAt: new Date()
    };

    imageQueue.push(queueItem);

    // Add to original images UI immediately
    addOriginalImageToResults(queueItem);

    // Update aspect ratio for resize controls if this is the first image
    if (imageQueue.length === 1 && queueItem.url) {
        updateAspectRatioFromImage(queueItem.url);
    }

    updateQueueInfo();
}

function clearQueue() {
    imageQueue = [];
    processedImages = [];
    originalImagesContainer.innerHTML = '';
    processedImagesContainer.innerHTML = '';
    updateQueueInfo();
    status.textContent = 'ล้างคิวแล้ว';

    // Show upload section when queue is cleared
    uploadSection.style.display = 'block';
}

function updateQueueInfo() {
    const pending = imageQueue.filter(item => item.status === 'pending').length;
    const processing = imageQueue.filter(item => item.status === 'processing').length;
    const completed = processedImages.length;

    queueInfo.textContent = `คิว: ${pending} รอดำเนินการ, ${processing} กำลังประมวลผล, ${completed} เสร็จสิ้น`;

    // Add safety checks for button elements
    if (startProcessingBtn) {
        startProcessingBtn.disabled = isProcessing || pending === 0;
    }
    if (clearQueueBtn) {
        clearQueueBtn.disabled = isProcessing;
    }
    if (downloadAllBtn) {
        downloadAllBtn.disabled = completed === 0;
    }

    // Show/hide upload section based on queue status (with safety check)
    const uploadSectionElement = document.getElementById('upload-section');
    if (uploadSectionElement) {
        uploadSectionElement.style.display = 'block';
    }

}

async function processQueue() {
    if (isProcessing || imageQueue.length === 0) {
        return;
    }

    isProcessing = true;
    updateQueueInfo();

    while (imageQueue.length > 0) {
        const item = imageQueue.find(item => item.status === 'pending');
        if (!item) break;

        item.status = 'processing';
        currentProcessingIndex++;

        // Update original image status in UI
        updateOriginalImageStatus(item.id, 'processing');

        updateQueueInfo();

        try {
            const result = await processImage(item);

            // Update original image status to success
            updateOriginalImageStatus(item.id, 'completed');

            // Remove from queue and add to processed
            imageQueue = imageQueue.filter(qItem => qItem.id !== item.id);
            processedImages.push(result);

            // Remove original image from UI after successful processing
            const originalElement = originalImagesContainer.querySelector(`[data-id="${item.id}"]`);
            if (originalElement) {
                originalElement.remove();
            }

            // Add to processed images UI
            addProcessedImageToResults(result);

        } catch (error) {
            console.error('Error processing image:', error);
            item.status = 'error';
            item.error = error.message;
            // Update the existing original image with error state
            updateOriginalImageStatus(item.id, 'error');
        }

        updateQueueInfo();
    }

    isProcessing = false;
    status.textContent = 'ประมวลผลรูปภาพทั้งหมดเสร็จสิ้น!';
    updateQueueInfo();
}

// Update aspect ratio from image
function updateAspectRatioFromImage(imageUrl) {
    const img = new Image();
    img.onload = () => {
        originalAspectRatio = img.width / img.height;
        exportWidthInput.value = img.width;
        exportHeightInput.value = img.height;
    };
    img.src = imageUrl;
}

// Resize canvas function
function resizeCanvas(sourceCanvas, targetWidth, targetHeight) {
    const resizedCanvas = document.createElement('canvas');
    resizedCanvas.width = targetWidth;
    resizedCanvas.height = targetHeight;
    const ctx = resizedCanvas.getContext('2d');

    // Use high-quality image smoothing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Draw the source canvas onto the resized canvas
    ctx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height,
        0, 0, targetWidth, targetHeight);

    return resizedCanvas;
}

// Process a single image
async function processImage(item) {
    status.textContent = `กำลังประมวลผล ${item.name}... (${currentProcessingIndex})`;

    // Read image
    const image = await RawImage.fromURL(item.url);

    // Preprocess image
    const { pixel_values } = await processor(image);

    // Predict alpha matte
    const { output } = await model({ input: pixel_values });

    // Resize mask back to original size
    const mask = await RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(image.width, image.height);

    // Create new canvas
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');

    // Draw original image output to canvas
    ctx.drawImage(image.toCanvas(), 0, 0);

    // Update alpha channel
    const pixelData = ctx.getImageData(0, 0, image.width, image.height);
    for (let i = 0; i < mask.data.length; ++i) {
        pixelData.data[4 * i + 3] = mask.data[i];
    }
    ctx.putImageData(pixelData, 0, 0);

    // Apply resize if custom size is enabled
    const finalCanvas = useCustomSizeCheckbox.checked ?
        resizeCanvas(canvas, parseInt(exportWidthInput.value), parseInt(exportHeightInput.value)) :
        canvas;

    return {
        ...item,
        originalImage: image,
        processedCanvas: finalCanvas,
        processedAt: new Date(),
        dimensions: {
            width: finalCanvas.width,
            height: finalCanvas.height,
            originalWidth: image.width,
            originalHeight: image.height
        }
    };
}

// Add original image to original images section
function addOriginalImageToResults(item) {
    const resultDiv = document.createElement('div');
    resultDiv.className = 'image-result original-image';
    resultDiv.setAttribute('data-id', item.id);

    const statusClass = item.status === 'error' ? 'error' : item.status;
    const statusText = item.status === 'error' ? `❌ ข้อผิดพลาด: ${item.error}` :
        item.status === 'processing' ? '⏳ กำลังประมวลผล...' :
            item.status === 'pending' ? '⏸️ รอดำเนินการ' : '✅ พร้อม';

    resultDiv.innerHTML = `
        <div class="image-container">
            <img src="${item.url}" alt="${item.name}" />
        </div>
        <div class="image-info">
            <div><strong>${item.name}</strong></div>
            <div class="status ${statusClass}">${statusText}</div>
            <div>เพิ่มเมื่อ: ${item.addedAt.toLocaleTimeString()}</div>
            ${item.size ? `<div>ขนาด: ${(item.size / 1024).toFixed(1)} KB</div>` : ''}
        </div>
        <div class="image-actions">
            <button onclick="removeOriginalImage('${item.id}')">ลบ</button>
        </div>
    `;

    originalImagesContainer.appendChild(resultDiv);
}

// Add processed image to processed images section
function addProcessedImageToResults(result) {
    const resultDiv = document.createElement('div');
    resultDiv.className = 'image-result processed-image';
    resultDiv.setAttribute('data-id', result.id);
    resultDiv.innerHTML = `
        <div class="image-container">
            <canvas></canvas>
        </div>
        <div class="image-info">
            <div><strong>${result.name}</strong></div>
            <div>ส่งออก: ${result.dimensions.width} × ${result.dimensions.height}</div>
            ${result.dimensions.originalWidth && result.dimensions.originalHeight &&
            (result.dimensions.width !== result.dimensions.originalWidth || result.dimensions.height !== result.dimensions.originalHeight) ?
            `<div>ต้นฉบับ: ${result.dimensions.originalWidth} × ${result.dimensions.originalHeight}</div>` : ''}
            <div>✅ ประมวลผลเมื่อ: ${result.processedAt.toLocaleTimeString()}</div>
        </div>
        <div class="image-actions">
            <button onclick="cropImage('${result.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6.13 1L6 16a2 2 0 0 0 2 2h15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M1 6.13L16 6a2 2 0 0 1 2 2v15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              ครอบตัด
            </button>
            <button onclick="downloadImage('${result.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <polyline points="7,10 12,15 17,10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
              ดาวน์โหลด
            </button>
            <button onclick="removeProcessedImage('${result.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <polyline points="3,6 5,6 21,6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              ลบ
            </button>
        </div>
    `;

    const canvas = resultDiv.querySelector('.image-container canvas');
    canvas.width = result.processedCanvas.width;
    canvas.height = result.processedCanvas.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(result.processedCanvas, 0, 0);

    processedImagesContainer.appendChild(resultDiv);
}

// Download functions
function downloadImage(imageId) {
    console.log('Download requested for ID:', imageId);
    console.log('Available processed images:', processedImages.map(img => ({ id: img.id, name: img.name })));

    const result = processedImages.find(img => img.id === imageId);
    if (!result) {
        console.error('Image not found for download:', imageId);
        alert('ข้อผิดพลาด: ไม่พบรูปภาพสำหรับดาวน์โหลด');
        return;
    }

    try {
        const link = document.createElement('a');
        const fileName = result.name.includes('.') ?
            result.name.substring(0, result.name.lastIndexOf('.')) :
            result.name;
        link.download = `${fileName}_no_bg.png`;
        link.href = result.processedCanvas.toDataURL('image/png');

        // Add the link to the document temporarily
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        console.log('Download initiated for:', result.name);
    } catch (error) {
        console.error('Download error:', error);
        alert('ข้อผิดพลาดในการดาวน์โหลดรูปภาพ: ' + error.message);
    }
}

function downloadAllProcessed() {
    if (processedImages.length === 0) {
        alert('ไม่มีรูปภาพที่ประมวลผลแล้วให้ดาวน์โหลด');
        return;
    }

    console.log('Downloading all processed images:', processedImages.length);
    processedImages.forEach((result, index) => {
        // Stagger downloads to avoid browser blocking
        setTimeout(() => downloadImage(result.id), index * 200);
    });
}

function removeOriginalImage(imageId) {
    // Remove from queue if still pending
    imageQueue = imageQueue.filter(img => img.id !== imageId);
    updateQueueInfo();

    // Remove from UI
    const element = originalImagesContainer.querySelector(`[data-id="${imageId}"]`);
    if (element) {
        element.remove();
    }
}

function removeProcessedImage(imageId) {
    processedImages = processedImages.filter(img => img.id !== imageId);
    updateQueueInfo();

    // Remove from UI
    const element = processedImagesContainer.querySelector(`[data-id="${imageId}"]`);
    if (element) {
        element.remove();
    }
}

// Update original image status in UI
function updateOriginalImageStatus(imageId, status) {
    const element = originalImagesContainer.querySelector(`[data-id="${imageId}"]`);
    if (element) {
        const statusElement = element.querySelector('.status');
        if (statusElement) {
            statusElement.className = `status ${status}`;
            let statusText;
            if (status === 'error') {
                const item = imageQueue.find(img => img.id === imageId);
                statusText = item && item.error ? `❌ ${item.error}` : '❌ ข้อผิดพลาดในการประมวลผล';
            } else {
                statusText = status === 'processing' ? '⏳ กำลังประมวลผล...' :
                    status === 'pending' ? '⏸️ รอดำเนินการ' :
                        status === 'completed' ? '✅ ลบพื้นหลังแล้ว' : '✅ พร้อม';
            }
            statusElement.textContent = statusText;
        }
    }
}

// Crop functionality
function cropImage(imageId) {
    const result = processedImages.find(img => img.id === imageId);
    if (!result) {
        alert('ข้อผิดพลาด: ไม่พบรูปภาพสำหรับครอบตัด');
        return;
    }

    // Create crop modal
    const modal = document.createElement('div');
    modal.className = 'crop-modal';
    modal.innerHTML = `
        <div class="crop-container">
            <div class="crop-header">
                <h3>ครอบตัดรูปภาพ: ${result.name}</h3>
                <button class="close-crop" onclick="closeCropModal()">&times;</button>
            </div>
            <div class="crop-canvas-container">
                <canvas class="crop-canvas"></canvas>
                <div class="crop-selection"></div>
            </div>
            <div class="crop-controls">
                <button onclick="applyCrop('${imageId}')">ใช้การครอบตัด</button>
                <button onclick="closeCropModal()">ยกเลิก</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Setup crop canvas
    const cropCanvas = modal.querySelector('.crop-canvas');
    const cropSelection = modal.querySelector('.crop-selection');
    const container = modal.querySelector('.crop-canvas-container');

    // Set canvas size and draw image
    const maxSize = 400;
    const scale = Math.min(maxSize / result.processedCanvas.width, maxSize / result.processedCanvas.height);
    cropCanvas.width = result.processedCanvas.width * scale;
    cropCanvas.height = result.processedCanvas.height * scale;

    const ctx = cropCanvas.getContext('2d');
    ctx.drawImage(result.processedCanvas, 0, 0, cropCanvas.width, cropCanvas.height);

    // Initialize crop selection
    let isSelecting = false;
    let startX, startY, currentX, currentY;

    function updateSelection() {
        const rect = cropCanvas.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        const left = Math.min(startX, currentX);
        const top = Math.min(startY, currentY);
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);

        cropSelection.style.left = (left + rect.left - containerRect.left) + 'px';
        cropSelection.style.top = (top + rect.top - containerRect.top) + 'px';
        cropSelection.style.width = width + 'px';
        cropSelection.style.height = height + 'px';
        cropSelection.style.display = 'block';
    }

    cropCanvas.addEventListener('mousedown', (e) => {
        const rect = cropCanvas.getBoundingClientRect();
        startX = e.clientX - rect.left;
        startY = e.clientY - rect.top;
        isSelecting = true;
        cropSelection.style.display = 'none';
    });

    cropCanvas.addEventListener('mousemove', (e) => {
        if (!isSelecting) return;
        const rect = cropCanvas.getBoundingClientRect();
        currentX = e.clientX - rect.left;
        currentY = e.clientY - rect.top;
        updateSelection();
    });

    cropCanvas.addEventListener('mouseup', () => {
        isSelecting = false;
    });

    // Store crop data for later use
    modal.cropData = {
        imageId,
        scale,
        canvas: cropCanvas,
        selection: cropSelection
    };
}

function closeCropModal() {
    const modal = document.querySelector('.crop-modal');
    if (modal) {
        modal.remove();
    }
}

function applyCrop(imageId) {
    const modal = document.querySelector('.crop-modal');
    const cropData = modal.cropData;

    if (!cropData) {
        alert('ข้อผิดพลาด: ไม่พบข้อมูลการครอบตัด');
        return;
    }

    const selection = cropData.selection;
    const selectionRect = selection.getBoundingClientRect();
    const canvasRect = cropData.canvas.getBoundingClientRect();

    // Check if selection exists
    if (selection.style.display === 'none' ||
        parseInt(selection.style.width) === 0 ||
        parseInt(selection.style.height) === 0) {
        alert('กรุณาเลือกพื้นที่ที่ต้องการครอบตัด');
        return;
    }

    // Calculate crop coordinates relative to canvas
    const containerRect = cropData.canvas.parentElement.getBoundingClientRect();
    const cropX = (parseInt(selection.style.left) - (canvasRect.left - containerRect.left)) / cropData.scale;
    const cropY = (parseInt(selection.style.top) - (canvasRect.top - containerRect.top)) / cropData.scale;
    const cropWidth = parseInt(selection.style.width) / cropData.scale;
    const cropHeight = parseInt(selection.style.height) / cropData.scale;

    // Find the original result
    const result = processedImages.find(img => img.id === imageId);
    if (!result) {
        alert('ข้อผิดพลาด: ไม่พบรูปภาพ');
        return;
    }

    // Create cropped canvas
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = cropWidth;
    croppedCanvas.height = cropHeight;
    const croppedCtx = croppedCanvas.getContext('2d');

    // Draw cropped portion
    croppedCtx.drawImage(
        result.processedCanvas,
        cropX, cropY, cropWidth, cropHeight,
        0, 0, cropWidth, cropHeight
    );

    // Update the result with cropped canvas
    result.processedCanvas = croppedCanvas;
    result.dimensions.width = cropWidth;
    result.dimensions.height = cropHeight;

    // Update the UI
    const resultElement = processedImagesContainer.querySelector(`[data-id="${imageId}"]`);
    if (resultElement) {
        const canvas = resultElement.querySelector('canvas');
        canvas.width = croppedCanvas.width;
        canvas.height = croppedCanvas.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(croppedCanvas, 0, 0);

        // Update dimensions display
        const dimensionsDiv = resultElement.querySelector('.image-info div:nth-child(2)');
        if (dimensionsDiv) {
            dimensionsDiv.textContent = `ส่งออก: ${Math.round(cropWidth)} × ${Math.round(cropHeight)}`;
        }
    }

    closeCropModal();
    alert('ครอบตัดรูปภาพสำเร็จ!');
}

// Make functions global for onclick handlers
window.downloadImage = downloadImage;
window.removeOriginalImage = removeOriginalImage;
window.removeProcessedImage = removeProcessedImage;
window.cropImage = cropImage;
window.closeCropModal = closeCropModal;
window.applyCrop = applyCrop;

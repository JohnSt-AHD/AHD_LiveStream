// API Configuration
const API_BASE = '/api/traccar';

// Refresh interval in milliseconds (10 seconds)
const REFRESH_INTERVAL = 10000;

let authToken = null;
let devices = [];
let positions = {};

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    authenticate();
    setInterval(updateData, REFRESH_INTERVAL);
});

/**
 * Authenticate with Traccar API via backend proxy
 */
async function authenticate() {
    try {
        const response = await fetch(`${API_BASE}?action=auth`);
        const session = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(session.error || `Authentication failed: ${response.status}`);
        }

        authToken = session.token || true;
        
        console.log('Authentication successful');
        updateData();
    } catch (error) {
        console.error('Authentication error:', error);
        showError('Failed to authenticate with Traccar server');
    }
}

/**
 * Fetch devices from Traccar API via backend proxy
 */
async function fetchDevices() {
    try {
        const response = await fetch(`${API_BASE}?action=devices`);

        if (!response.ok) {
            throw new Error(`Failed to fetch devices: ${response.status}`);
        }

        devices = await response.json();
        return devices;
    } catch (error) {
        console.error('Error fetching devices:', error);
        return [];
    }
}

/**
 * Fetch positions from Traccar API via backend proxy
 */
async function fetchPositions() {
    try {
        const response = await fetch(`${API_BASE}?action=positions`);

        if (!response.ok) {
            throw new Error(`Failed to fetch positions: ${response.status}`);
        }

        const positionsList = await response.json();
        positions = {};
        
        positionsList.forEach(pos => {
            positions[pos.deviceId] = pos;
        });
        
        return positions;
    } catch (error) {
        console.error('Error fetching positions:', error);
        return {};
    }
}

/**
 * Update all data and refresh display
 */
async function updateData() {
    await Promise.all([
        fetchDevices(),
        fetchPositions()
    ]);
    
    renderDevices();
    updateTimestamp();
}

/**
 * Render devices to the DOM
 */
function renderDevices() {
    const container = document.getElementById('devicesContainer');
    
    if (devices.length === 0) {
        container.innerHTML = '<div class="error">No devices found</div>';
        return;
    }

    let html = '';

    devices.forEach(device => {
        const position = positions[device.id];
        const isOnline = position && isPositionRecent(position.fixTime);
        const speedKmh = position ? (position.speed * 3.6).toFixed(1) : 'N/A'; // Convert m/s to km/h
        const latitude = position ? position.latitude.toFixed(6) : 'N/A';
        const longitude = position ? position.longitude.toFixed(6) : 'N/A';
        const course = position ? position.course.toFixed(0) : 'N/A';
        const altitude = position ? position.altitude.toFixed(1) : 'N/A';
        const fixTime = position ? formatDateTime(position.fixTime) : 'N/A';
        const address = position ? (position.address || 'Unknown') : 'Unknown';

        const statusClass = isOnline ? 'online' : 'offline';
        const statusText = isOnline ? 'ONLINE' : 'OFFLINE';
        const speedClass = position && position.speed > 5 ? 'speed-warning' : 'speed-normal';

        html += `
            <div class="device-card">
                <div class="device-name">${device.name}</div>
                <div class="device-status ${statusClass}">${statusText}</div>
                <div class="device-info">
                    <div class="info-row">
                        <span class="info-label">Speed:</span>
                        <span class="info-value ${speedClass}">${speedKmh} km/h</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Latitude:</span>
                        <span class="info-value">${latitude}°</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Longitude:</span>
                        <span class="info-value">${longitude}°</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Course:</span>
                        <span class="info-value">${course}°</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Altitude:</span>
                        <span class="info-value">${altitude} m</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Last Update:</span>
                        <span class="info-value">${fixTime}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Location:</span>
                        <span class="info-value" style="word-break: break-word;">${address}</span>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

/**
 * Check if position data is recent (within 5 minutes)
 */
function isPositionRecent(fixTime) {
    const fixTimeDate = new Date(fixTime);
    const now = new Date();
    const diffMs = now - fixTimeDate;
    const diffMinutes = diffMs / (1000 * 60);
    return diffMinutes < 5;
}

/**
 * Format datetime string
 */
function formatDateTime(dateString) {
    const date = new Date(dateString);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

/**
 * Update last update timestamp
 */
function updateTimestamp() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    document.getElementById('lastUpdate').textContent = `Last updated: ${hours}:${minutes}:${seconds}`;
}

/**
 * Show error message
 */
function showError(message) {
    const container = document.getElementById('devicesContainer');
    container.innerHTML = `<div class="error">${message}</div>`;
}

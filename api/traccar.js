export default async function handler(req, res) {
    const { action } = req.query;

    const TRACCAR_URL = "https://xmvjx05iw.traccar.com";
    const USERNAME = "j.w.storey21@gmail.com";
    const PASSWORD = "admin";

    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        if (action === 'auth') {
            // Authenticate with Traccar
            const authResponse = await fetch(`${TRACCAR_URL}/api/session`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `email=${encodeURIComponent(USERNAME)}&password=${encodeURIComponent(PASSWORD)}`
            });

            if (!authResponse.ok) {
                throw new Error(`Traccar authentication failed: ${authResponse.status}`);
            }

            const session = await authResponse.json();
            res.status(200).json({ token: session.token });

        } else if (action === 'devices') {
            // Fetch devices - authenticate first
            const authResponse = await fetch(`${TRACCAR_URL}/api/session`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `email=${encodeURIComponent(USERNAME)}&password=${encodeURIComponent(PASSWORD)}`
            });

            if (!authResponse.ok) {
                throw new Error('Authentication failed');
            }

            const session = await authResponse.json();
            const devicesResponse = await fetch(`${TRACCAR_URL}/api/devices`, {
                headers: {
                    'Cookie': `JSESSIONID=${session.token}`
                }
            });

            if (!devicesResponse.ok) {
                throw new Error(`Failed to fetch devices: ${devicesResponse.status}`);
            }

            const devices = await devicesResponse.json();
            res.status(200).json(devices);

        } else if (action === 'positions') {
            // Fetch positions - authenticate first
            const authResponse = await fetch(`${TRACCAR_URL}/api/session`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `email=${encodeURIComponent(USERNAME)}&password=${encodeURIComponent(PASSWORD)}`
            });

            if (!authResponse.ok) {
                throw new Error('Authentication failed');
            }

            const session = await authResponse.json();
            const positionsResponse = await fetch(`${TRACCAR_URL}/api/positions`, {
                headers: {
                    'Cookie': `JSESSIONID=${session.token}`
                }
            });

            if (!positionsResponse.ok) {
                throw new Error(`Failed to fetch positions: ${positionsResponse.status}`);
            }

            const positions = await positionsResponse.json();
            res.status(200).json(positions);

        } else {
            res.status(400).json({ error: 'Invalid action' });
        }

    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: error.message });
    }
}

export default async function handler(req, res) {
  console.log('Webhook received:', req.method, req.body);
  
  if (req.method === 'POST') {
    return res.status(200).json({ 
      success: true, 
      message: 'Webhook received',
      data: req.body 
    });
  }
  
  return res.status(200).json({ 
    status: 'ok',
    message: 'Babyland Lead Hub Webhook is running'
  });
}
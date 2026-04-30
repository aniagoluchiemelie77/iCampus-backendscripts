
router.post("/persona-webhook", async (req, res) => {
  const { attributes, relationships } = req.body.data;
  
  if (attributes.status === "passed") {
    const userId = attributes['reference-id'];
    
    // Update your database
    await User.findOneAndUpdate({ uid: userId }, { isVerified: true });
    
    // This is when your EditProfileScreen 'isLocked' logic will trigger!
  }
  res.sendStatus(200);
});